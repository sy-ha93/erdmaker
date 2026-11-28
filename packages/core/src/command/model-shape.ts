import { normalizePath } from '../fs/path.js';
import type { SchemaName } from '../schema/ajv.js';

/** The five lists `writeChanges` writes and removes, with their schemas. */
export const SAVED_LISTS = [
  ['entities', 'entity'],
  ['relationships', 'relationship'],
  ['subtypes', 'subtype'],
  ['subjectAreas', 'subject-area'],
  ['layouts', 'layout'],
] as const satisfies readonly (readonly [string, SchemaName])[];

export type SavedList = (typeof SAVED_LISTS)[number][0];
type ListName = SavedList | 'dictionaries';

const LISTS: readonly ListName[] = [
  ...SAVED_LISTS.map(([list]) => list),
  'dictionaries',
];

/** One item as read once: where it is, its `file`, and the item object. */
export interface ShapeItem<L extends string = ListName> {
  list: L;
  index: number;
  file: string;
  item: object;
}

/**
 * What a model that keeps the conditions of FR-01 holds, each place read
 * once. `items` are those of the five saved lists, in list order.
 */
export interface ModelShape {
  dir: string;
  manifest: ShapeItem<'manifest'> | undefined;
  items: ShapeItem<SavedList>[];
  dictionaries: ShapeItem<'dictionaries'>[];
}

/** A property, or `failed` when reading it throws (a getter, a Proxy trap). */
const failed: unique symbol = Symbol('failed');
function read(from: object, key: string): unknown {
  try {
    return (from as Record<string, unknown>)[key];
  } catch {
    return failed;
  }
}

function isList(value: unknown): value is unknown[] {
  try {
    return Array.isArray(value);
  } catch {
    // A revoked Proxy.
    return false;
  }
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

/** The items of a list, or `undefined` when its length or an index throws. */
function listItems(list: unknown[]): unknown[] | undefined {
  try {
    const { length } = list;
    if (!Number.isSafeInteger(length) || length < 0) return undefined;
    const out: unknown[] = [];
    for (let i = 0; i < length; i += 1) out.push(read(list, String(i)));
    return out;
  } catch {
    return undefined;
  }
}

/** The item's `file` when it is an object whose `file` is a string. */
function itemFile(item: unknown): string | undefined {
  if (!isObject(item)) return undefined;
  const file = read(item, 'file');
  return typeof file === 'string' ? file : undefined;
}

/**
 * Whether `file` is inside `dir`, component by component: `dir` is a
 * leading part of it, shorter than it. Both are normalized, so `..` only
 * leads.
 */
function isInside(file: string, dir: string): boolean {
  if (dir === '') return file !== '..' && !file.startsWith('../');
  return file.startsWith(`${dir}/`);
}

/**
 * Reads the model once and checks the conditions 1 to 4 of FR-01 in that
 * order; the lists in `Model` order, items in list order (manifest first).
 * Gives the reason of the first one broken, as the messages of FR-01 name
 * it, or the places it read. Never throws: a place whose read throws breaks
 * the condition about that place. Linear in the number of items.
 */
export function readModelShape(
  model: unknown,
): { reason: string } | { shape: ModelShape } {
  if (!isObject(model)) return { reason: 'it is not an object' };

  const dir = read(model, 'dir');
  if (typeof dir !== 'string' || normalizePath(dir) !== dir) {
    return { reason: 'dir is not a normalized path' };
  }

  const lists = new Map<ListName, unknown[]>();
  for (const name of LISTS) {
    const list = read(model, name);
    const items = isList(list) ? listItems(list) : undefined;
    if (!items) return { reason: `${name} is not a list` };
    lists.set(name, items);
  }

  let manifest: ShapeItem<'manifest'> | undefined;
  const rawManifest = read(model, 'manifest');
  if (rawManifest !== undefined) {
    const file = itemFile(rawManifest);
    if (file === undefined) return { reason: 'manifest is not an item' };
    manifest = {
      list: 'manifest',
      index: 0,
      file,
      item: rawManifest as object,
    };
  }
  const items: ShapeItem<SavedList>[] = [];
  const dictionaries: ShapeItem<'dictionaries'>[] = [];
  for (const name of LISTS) {
    const list = lists.get(name)!;
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      const file = itemFile(item);
      if (file === undefined)
        return { reason: `${name}[${index}] is not an item` };
      if (name === 'dictionaries') {
        dictionaries.push({ list: name, index, file, item: item as object });
      } else {
        items.push({ list: name, index, file, item: item as object });
      }
    }
  }

  const all = manifest
    ? [manifest, ...items, ...dictionaries]
    : [...items, ...dictionaries];
  let twice: string | undefined;
  const seen = new Set<string>();
  for (const { file } of all) {
    if (file === '' || normalizePath(file) !== file) {
      return { reason: `${file} is not a normalized file path` };
    }
    if (twice === undefined && seen.has(file)) twice = file;
    seen.add(file);
  }
  if (twice !== undefined) return { reason: `${twice} is used by two items` };

  for (const { file } of items) {
    if (!isInside(file, dir)) {
      return { reason: `${file} is outside the model folder` };
    }
  }
  return { shape: { dir, manifest, items, dictionaries } };
}

/**
 * The reason a model breaks the conditions 1 to 4 of FR-01 (the text after
 * `Cannot edit the model: ` or `Cannot save: `), or `undefined` when it
 * keeps them. Never throws.
 */
export function checkEditable(model: unknown): string | undefined {
  const read = readModelShape(model);
  return 'reason' in read ? read.reason : undefined;
}
