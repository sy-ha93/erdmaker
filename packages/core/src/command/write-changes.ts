import { compareCodeUnits } from '../compare.js';
import { FileNotFoundError, type FileSystemAdapter } from '../fs/adapter.js';
import { serializeItem } from '../model/serialize-item.js';
import type { ReadonlyModel } from '../model/types.js';
import type { SchemaName } from '../schema/ajv.js';
import {
  type ModelShape,
  readModelShape,
  SAVED_LISTS,
  type SavedList,
} from './model-shape.js';
import { pathKey } from './paths.js';

const SCHEMAS: ReadonlyMap<SavedList, SchemaName> = new Map(SAVED_LISTS);

interface Write {
  file: string;
  item: object;
  schema: SchemaName;
  isNew: boolean;
}

/** The shape of a model, or the `TypeError` of FR-09's first check. */
function shapeOf(model: unknown): ModelShape {
  const read = readModelShape(model);
  if ('reason' in read) throw new TypeError(`Cannot save: ${read.reason}`);
  return read.shape;
}

/** The folder part of a normalized path; `""` for a path with no `/`. */
function parentOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at === -1 ? '' : path.slice(0, at);
}

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/**
 * Check (2): the first pair, by smaller then larger path, of two paths of
 * the five lists with one key and different text, one of which the save
 * writes or removes.
 */
function letterCasePair(
  paths: ReadonlySet<string>,
  touched: ReadonlySet<string>,
): [string, string] | undefined {
  const byKey = new Map<string, string[]>();
  for (const path of paths) {
    const key = pathKey(path);
    const group = byKey.get(key);
    if (group) group.push(path);
    else byKey.set(key, [path]);
  }
  let first: [string, string] | undefined;
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    group.sort(compareCodeUnits);
    // The smallest path of a pair is always the group's first; the larger
    // is the next one when the first is touched, else the first touched.
    const larger = touched.has(group[0]!)
      ? group[1]
      : group.find((path) => touched.has(path));
    if (larger === undefined) continue;
    const pair: [string, string] = [group[0]!, larger];
    if (
      !first ||
      compareCodeUnits(pair[0], first[0]) < 0 ||
      (pair[0] === first[0] && compareCodeUnits(pair[1], first[1]) < 0)
    ) {
      first = pair;
    }
  }
  return first;
}

const occupied = (path: string) =>
  new Error(`Cannot save: ${path} already exists and is not part of the model`);

/**
 * Saves `after` over `before` (spec FR-09): writes the items of the five
 * lists (entities, relationships, subtypes, subject areas, layouts) whose
 * object is not the one `before` has at that `file`, when their text differs
 * from the file there, and removes the files `before` had that `after` does
 * not. The manifest and dictionaries are never read, written or removed.
 * Which item owns a path is decided by the `file` values alone.
 *
 * Five checks come first, in this order, each stopping at its first
 * failure; a rejection in them reads or changes nothing it should not:
 * 1. both models keep FR-01's conditions 1 to 4 (`before` first) and have
 *    one `dir`: a `TypeError`, with no adapter call;
 * 2. no path the save writes or removes shares its key (`pathKey`) with
 *    another path of the two models' five lists: an `Error`, no adapter call;
 * 3. the items to write are serialized in code unit order of path: the
 *    error of the first that fails, no adapter call;
 * 4. the parent folder of each new path (one `after` has and `before` has
 *    not), in code unit order, is listed once; an entry whose name has the
 *    key of a new path's name occupies it: an adapter error, or `Cannot
 *    save: <path> already exists and is not part of the model`;
 * 5. each path to write is read once, in code unit order: a read error
 *    other than not found, or a new path that reads, rejects.
 *
 * Then every write, in code unit order, and only when all have succeeded
 * every removal, in code unit order. A failing write rejects with its error
 * and removes nothing; a failing removal rejects with its error after all
 * writes. Returns the paths written and those removed (a file already gone
 * included), in code unit order. Never throws synchronously.
 */
export async function writeChanges(
  fs: FileSystemAdapter,
  before: ReadonlyModel,
  after: ReadonlyModel,
): Promise<{ written: string[]; removed: string[] }> {
  // (1)
  const old = shapeOf(before);
  const next = shapeOf(after);
  if (old.dir !== next.dir) {
    throw new TypeError('Cannot save: the two models have different folders');
  }

  const owned = new Map<string, object>();
  for (const { file, item } of old.items) owned.set(file, item);
  const kept = new Set<string>();
  const writes: Write[] = [];
  for (const { file, item, list } of next.items) {
    kept.add(file);
    const had = owned.get(file);
    if (had === item) continue;
    writes.push({
      file,
      item,
      schema: SCHEMAS.get(list)!,
      isNew: had === undefined,
    });
  }
  writes.sort((a, b) => compareCodeUnits(a.file, b.file));
  const removals: string[] = [];
  for (const file of owned.keys()) if (!kept.has(file)) removals.push(file);
  removals.sort(compareCodeUnits);

  // (2)
  const touched = new Set<string>(removals);
  for (const { file } of writes) touched.add(file);
  const pair = letterCasePair(new Set([...owned.keys(), ...kept]), touched);
  if (pair) {
    throw new Error(
      `Cannot save: ${pair[0]} and ${pair[1]} differ only in letter case`,
    );
  }

  // (3)
  const texts: string[] = [];
  for (const { file, item, schema } of writes) {
    texts.push(serializeItem(file, (item as { data?: unknown }).data, schema));
  }

  // (4)
  const byParent = new Map<string, string[]>();
  for (const { file, isNew } of writes) {
    if (!isNew) continue;
    const parent = parentOf(file);
    const paths = byParent.get(parent);
    // `writes` is in code unit order, so each folder's paths are too.
    if (paths) paths.push(file);
    else byParent.set(parent, [file]);
  }
  for (const parent of [...byParent.keys()].sort(compareCodeUnits)) {
    const names = new Set<string>();
    for (const entry of await fs.list(parent)) names.add(pathKey(entry.name));
    for (const path of byParent.get(parent)!) {
      if (names.has(pathKey(nameOf(path)))) throw occupied(path);
    }
  }

  // (5)
  const changed: { file: string; text: string }[] = [];
  for (let i = 0; i < writes.length; i += 1) {
    const { file, isNew } = writes[i]!;
    const text = texts[i]!;
    let current: string | undefined;
    try {
      current = await fs.readText(file);
    } catch (error) {
      if (!(error instanceof FileNotFoundError)) throw error;
    }
    if (current !== undefined && isNew) throw occupied(file);
    if (current !== text) changed.push({ file, text });
  }

  const written: string[] = [];
  for (const { file, text } of changed) {
    await fs.writeText(file, text);
    written.push(file);
  }
  const removed: string[] = [];
  for (const file of removals) {
    await fs.remove(file);
    removed.push(file);
  }
  return { written, removed };
}
