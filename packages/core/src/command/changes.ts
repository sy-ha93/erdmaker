import { serializeItem } from '../model/serialize-item.js';
import type { Issue, ReadonlyModel } from '../model/types.js';
import type { SchemaName } from '../schema/ajv.js';
import type { Issues } from './types.js';
import { noteWork } from './work.js';
import {
  type Cells,
  type Item,
  LIST_NAMES,
  type ListName,
  type Working,
} from './working.js';

const SCHEMAS: ReadonlyMap<ListName, SchemaName> = new Map([
  ['entities', 'entity'],
  ['relationships', 'relationship'],
  ['subtypes', 'subtype'],
  ['subjectAreas', 'subject-area'],
  ['layouts', 'layout'],
  ['dictionaries', 'dictionary'],
]);

/** An item's text as `serializeItem` writes it, or what it threw. */
type Written = { text: string } | { error: unknown };

function written(item: Item, schema: SchemaName): Written {
  try {
    return { text: serializeItem(item.file, item.data, schema) };
  } catch (error) {
    return { error };
  }
}

/**
 * A touched item `serializeItem` refuses although the item of its list and
 * file before the command did not (spec FR-04 (a)), and what it threw.
 */
export interface Unwritable {
  readonly file: string;
  readonly error: unknown;
}

/**
 * One changed list at the end (spec FR-08, "끝의 비교"): holes dropped, and
 * each item this state made that writes the same text as the start item of
 * its file replaced by that start item. `same` when the result is the start
 * list's set of items. Each item this state made is serialized once, and
 * the start item of its file at most once (for the comparison, or to learn
 * whether it could be written); no other item is. One that cannot be
 * written is changed: its data is a new object and no text says it is the
 * same (spec FR-02). The first of those whose start item could be written,
 * or that is new, is `unwritable`.
 */
function endList(
  working: Working,
  start: readonly Item[],
  cells: Cells,
  schema: SchemaName,
): { items: Item[]; same: boolean; unwritable: Unwritable | undefined } {
  noteWork('index-build', start.length);
  const byFile = new Map<string, Item>();
  for (const item of start) byFile.set(item.file, item);
  noteWork('scan', cells.length);
  const items: Item[] = [];
  let original = true;
  let unwritable: Unwritable | undefined;
  for (let p = 0; p < cells.length; p += 1) {
    const cell = cells[p];
    if (!cell) continue;
    let item = cell;
    if (working.isOwned(cell)) {
      const before = byFile.get(cell.file);
      const after = written(cell, schema);
      const old = before && written(before, schema);
      if ('text' in after) {
        if (old && 'text' in old && old.text === after.text) item = before!;
        else original = false;
      } else {
        original = false;
        // Unwritable before too: the command did not cause it.
        if (!(old && 'error' in old)) {
          unwritable ??= { file: cell.file, error: after.error };
        }
      }
    }
    items.push(item);
  }
  // Files are unique, so as many start items as the start list is that set.
  return {
    items,
    same: original && items.length === start.length,
    unwritable,
  };
}

/**
 * The model a working state ends with: the start model itself when it holds
 * the same items (spec FR-02, FR-08), otherwise a new model with new arrays
 * for the lists that differ and the start's arrays for the others. With it,
 * the first touched item in list order (the six lists in FR-01's order,
 * then by position) that cannot be written although it could before or is
 * new (spec FR-04 (a)).
 */
export function endModel(working: Working): {
  model: ReadonlyModel;
  unwritable: Unwritable | undefined;
} {
  const start = working.start;
  const changed = working.changedLists();
  const lists = new Map<ListName, readonly Item[]>();
  let same = true;
  let unwritable: Unwritable | undefined;
  for (const list of LIST_NAMES) {
    const startItems = start[list] as readonly Item[];
    const cells = changed.get(list);
    if (!cells) {
      lists.set(list, startItems);
      continue;
    }
    const end = endList(working, startItems, cells, SCHEMAS.get(list)!);
    lists.set(list, end.same ? startItems : end.items);
    if (!end.same) same = false;
    unwritable ??= end.unwritable;
  }
  if (same) return { model: start, unwritable: undefined };
  const model = {
    dir: start.dir,
    ...(start.manifest === undefined ? {} : { manifest: start.manifest }), // work-ok: the manifest field of the model record, not a list
    entities: lists.get('entities')!,
    relationships: lists.get('relationships')!,
    subtypes: lists.get('subtypes')!,
    subjectAreas: lists.get('subjectAreas')!,
    layouts: lists.get('layouts')!,
    dictionaries: lists.get('dictionaries')!,
  };
  return { model: model as ReadonlyModel, unwritable };
}

/** The number of errors in `issues`. */
export function errorCount(issues: Issues): number {
  let count = 0;
  for (const issue of issues) if (issue.severity === 'error') count += 1;
  return count;
}

/** Rule, file, path and message: what makes an error new in a refusal's issues (spec FR-04). */
const errorKey = (issue: Readonly<Issue>): string =>
  JSON.stringify([issue.rule, issue.file, issue.path, issue.message]);

/** Every field: what lets the old object stand for the new one (spec FR-02). */
const issueKey = (issue: Readonly<Issue>): string =>
  JSON.stringify([
    issue.rule,
    issue.file,
    issue.path,
    issue.message,
    issue.severity,
    issue.line,
    issue.column,
  ]);

/** The keys of the errors of `issues`. */
function errorKeys(issues: Issues): Set<string> {
  const keys = new Set<string>();
  for (const issue of issues) {
    if (issue.severity === 'error') keys.add(errorKey(issue));
  }
  return keys;
}

/**
 * The issues of a `validation` refusal for more errors (spec FR-04 (b)): the errors of `next`
 * with no error of `previous` of the same rule, file, path and message, in
 * the order of `next`; when there is none, every error of `next`.
 */
export function rejectionIssues(
  previous: Issues,
  next: Issues,
): Readonly<Issue>[] {
  const known = errorKeys(previous);
  const fresh: Readonly<Issue>[] = [];
  const errors: Readonly<Issue>[] = [];
  for (const issue of next) {
    if (issue.severity !== 'error') continue;
    errors.push(issue);
    if (!known.has(errorKey(issue))) fresh.push(issue);
  }
  return fresh.length > 0 ? fresh : errors;
}

/**
 * `next` with each issue whose rule, file, path, message, severity, line
 * and column are all those of an issue of `previous` replaced by that
 * object (spec FR-02, "이력의 메모리"), so history steps share them.
 */
export function reuseIssues(previous: Issues, next: Issues): Issues {
  const old = new Map<string, Readonly<Issue>>();
  for (const issue of previous) {
    const key = issueKey(issue);
    if (!old.has(key)) old.set(key, issue);
  }
  const kept: Readonly<Issue>[] = [];
  for (const issue of next) kept.push(old.get(issueKey(issue)) ?? issue);
  return kept;
}
