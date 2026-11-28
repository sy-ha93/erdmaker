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

/** Whether two items at one file write the same text; one that cannot be written differs. */
function sameText(a: Item, b: Item, schema: SchemaName): boolean {
  try {
    return (
      serializeItem(a.file, a.data, schema) ===
      serializeItem(b.file, b.data, schema)
    );
  } catch {
    return false;
  }
}

/**
 * One changed list at the end (spec FR-08, "끝의 비교"): holes dropped, and
 * each item this state made that writes the same text as the start item of
 * its file replaced by that start item. `same` when the result is the start
 * list's set of items.
 */
function endList(
  working: Working,
  start: readonly Item[],
  cells: Cells,
  schema: SchemaName,
): { items: Item[]; same: boolean } {
  noteWork('index-build', start.length);
  const byFile = new Map<string, Item>();
  // work-ok: the start items of one changed list, counted above (noteWork)
  for (const item of start) byFile.set(item.file, item);
  noteWork('scan', cells.length);
  const items: Item[] = [];
  let original = true;
  // work-ok: the cells of one changed list, counted above (noteWork)
  for (const cell of cells) {
    if (!cell) continue;
    let item = cell;
    if (working.isOwned(cell)) {
      const before = byFile.get(cell.file);
      if (before && sameText(before, cell, schema)) item = before;
      else original = false;
    }
    items.push(item);
  }
  // Files are unique, so as many start items as the start list is that set.
  return { items, same: original && items.length === start.length };
}

/**
 * The model a working state ends with: the start model itself when it holds
 * the same items (spec FR-02, FR-08), otherwise a new model with new arrays
 * for the lists that differ and the start's arrays for the others.
 */
export function endModel(working: Working): ReadonlyModel {
  const start = working.start;
  const changed = working.changedLists();
  const lists = new Map<ListName, readonly Item[]>();
  let same = true;
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
  }
  if (same) return start;
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
  return model as ReadonlyModel;
}

/** The number of errors in `issues`. */
export function errorCount(issues: Issues): number {
  let count = 0;
  // work-ok: the issues of one validation, twice per execute
  for (const issue of issues) if (issue.severity === 'error') count += 1;
  return count;
}

/** Rule, file, path and message: what makes an error new (spec FR-04). */
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
  // work-ok: the issues before the command, once per execute
  for (const issue of issues) {
    if (issue.severity === 'error') keys.add(errorKey(issue));
  }
  return keys;
}

/**
 * Whether `next` has a `schema` error that is new against `previous` (spec
 * FR-04, condition 1): no error of `previous` has its rule, file, path and
 * message. An item with a file-local error is left out of the cross-file
 * rules, so such an error can hide another and leave the count as it was.
 */
export function addsSchemaError(previous: Issues, next: Issues): boolean {
  let known: Set<string> | undefined;
  // work-ok: the issues of one validation, once per execute
  for (const issue of next) {
    if (issue.severity !== 'error' || issue.rule !== 'schema') continue;
    known ??= errorKeys(previous);
    if (!known.has(errorKey(issue))) return true;
  }
  return false;
}

/**
 * The issues of a `validation` refusal (spec FR-04): the errors of `next`
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
  // work-ok: the issues of one validation, once per execute
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
  // work-ok: the issues before the command, once per execute
  for (const issue of previous) {
    const key = issueKey(issue);
    if (!old.has(key)) old.set(key, issue);
  }
  const kept: Readonly<Issue>[] = [];
  // work-ok: the issues of one validation, once per execute
  for (const issue of next) kept.push(old.get(issueKey(issue)) ?? issue);
  return kept;
}
