import { compareCodeUnits } from '../compare.js';
import type { FileSystemAdapter } from '../fs/adapter.js';
import { joinPath, normalizePath } from '../fs/path.js';
import { dictionaryEntries } from '../model/dictionary-entries.js';
import { field, ownStrings } from '../validate/plain.js';

/** The folders new entities and subject areas go to (spec FR-06). */
export type NewItemFolder = 'entities' | 'subject-areas';

/**
 * The comparison key of a path (spec FR-06): NFKC, then lower case. Two
 * paths with one key are one file on a file system that ignores letter case
 * or normalization. The only case folding of paths in `command/`; never
 * throws.
 */
export function pathKey(path: string): string {
  return path.normalize('NFKC').toLowerCase();
}

/** The keys of `paths`. */
export function pathKeys(paths: Iterable<string>): Set<string> {
  const keys = new Set<string>();
  for (const path of paths) keys.add(pathKey(path));
  return keys;
}

/** The file of a new item: `<dir>/<folder>/<id>.yaml`, `dir` as the model has it. */
export function newItemFile(
  dir: string,
  folder: NewItemFolder,
  id: string,
): string {
  return joinPath(dir, folder, `${id}.yaml`);
}

/**
 * The paths of the model an editor was made with. They do not change while
 * the editor lives (spec FR-06).
 */
export class InitialPaths {
  private readonly paths = new Set<string>();
  /** Per key, its two first paths in code unit order. */
  private readonly byKey = new Map<string, [string, string | undefined]>();

  constructor(files: Iterable<string>) {
    for (const file of files) {
      if (this.paths.has(file)) continue;
      this.paths.add(file);
      const key = pathKey(file);
      const first = this.byKey.get(key);
      if (!first) this.byKey.set(key, [file, undefined]);
      else if (compareCodeUnits(file, first[0]) < 0) {
        this.byKey.set(key, [file, first[0]]);
      } else if (
        first[1] === undefined ||
        compareCodeUnits(file, first[1]) < 0
      ) {
        first[1] = file;
      }
    }
  }

  /** Whether an initial item had exactly this path. */
  has(path: string): boolean {
    return this.paths.has(path);
  }

  /**
   * The first initial path in code unit order whose text differs from
   * `path` and whose key is the same, if any.
   */
  otherCase(path: string): string | undefined {
    const first = this.byKey.get(pathKey(path));
    if (!first) return undefined;
    return first[0] !== path ? first[0] : first[1];
  }
}

const NOT_A_LIST =
  'Cannot edit the model: reservedFiles is not a list of paths';

/**
 * The reserved paths an editor keeps (spec FR-01, FR-06): each normalized,
 * once, in the order given, without empty ones and the paths an initial item
 * has. Throws only `TypeError(NOT_A_LIST)`: for anything but an array whose
 * length is a whole number up to 2³² − 1 and whose every index below it is
 * an own data property holding a string, read without calling a getter.
 */
export function reservedPaths(
  reservedFiles: unknown,
  initial: InitialPaths,
): string[] {
  // Each index through its descriptor, up to the first that fails.
  const files = ownStrings(reservedFiles);
  if (files === undefined) throw new TypeError(NOT_A_LIST);
  const kept = new Set<string>();
  for (const file of files) {
    const path = normalizePath(file);
    if (path !== '' && !initial.has(path)) kept.add(path);
  }
  return [...kept]; // work-ok: the reserved paths, once when the editor is made
}

/** The longest path the adapters take; a longer dictionary folder is left out. */
const MAX_FOLDER_LENGTH = 4096;

/**
 * `normalizePath(path)`, or `undefined` when the string is too large to
 * split or join (a `RangeError`): such a path is left out like a long one.
 */
function normalizedOrNone(path: string): string | undefined {
  try {
    return normalizePath(path);
  } catch (error) {
    if (error instanceof RangeError) return undefined;
    throw error;
  }
}

/** A normalized path cut into segments once: where each ends, and its `..` lead. */
interface Segmented {
  readonly path: string;
  /** The offset just past each segment. */
  readonly ends: readonly number[];
  /** How many leading segments are `..` (a normalized path has no other). */
  readonly ups: number;
}

const SLASH = 0x2f;

/** Whether the segment of `path` at `start` is `..`, ending the path or followed by `/`. */
const isUp = (path: string, start: number): boolean =>
  path.startsWith('..', start) &&
  (start + 2 === path.length || path.charCodeAt(start + 2) === SLASH);

/** `path` (normalized) cut into segments, in one pass over its characters. */
function segmented(path: string): Segmented {
  const ends: number[] = [];
  let ups = 0;
  if (path === '') return { path, ends, ups };
  let start = 0;
  for (let at = 0; at <= path.length; at += 1) {
    if (at < path.length && path.charCodeAt(at) !== SLASH) continue;
    if (ups === ends.length && at - start === 2 && isUp(path, start)) ups += 1;
    ends.push(at);
    start = at + 1;
  }
  return { path, ends, ups };
}

/**
 * `joinPath(base.path, folder)` for a normalized `folder`, or `undefined`
 * when that is longer than `limit`. Only the leading `..` of `folder` take
 * segments off `base` (once nothing but `..` is left, they add to it), so
 * the length is known before anything is joined: the work is the length of
 * `folder` plus at most `limit`.
 */
function joinWithin(
  base: Segmented,
  folder: string,
  limit: number,
): string | undefined {
  let ups = 0;
  let at = 0;
  while (at < folder.length && isUp(folder, at)) {
    ups += 1;
    at += 3;
  }
  const popped = Math.min(ups, base.ends.length - base.ups);
  const kept = base.ends.length - popped;
  const head = kept === 0 ? 0 : base.ends[kept - 1]!;
  const climbs = ups - popped;
  const restLength = Math.max(folder.length - at, 0);
  let length = head;
  for (const part of [climbs === 0 ? 0 : climbs * 3 - 1, restLength]) {
    if (part > 0) length += length === 0 ? part : part + 1;
  }
  if (length > limit) return undefined;
  // work-ok: one dictionary folder, built only within the 4096 limit
  let joined = base.path.slice(0, head);
  for (let i = 0; i < climbs; i += 1) joined += joined === '' ? '..' : '/..';
  if (restLength > 0) {
    // work-ok: one dictionary folder, built only within the 4096 limit
    const rest = folder.slice(at);
    joined += joined === '' ? rest : `/${rest}`;
  }
  return joined;
}

/**
 * The dictionary folders of a model (spec FR-06): `dictionaryEntries` of
 * the manifest item's `data` (read as an own data property; anything else
 * is no manifest), the rule `loadModel` reads them by, each joined to the
 * model folder and normalized, as `loadModel` does. The opened folder
 * itself is `""`. On the editor side only, a folder whose normalized path
 * is longer than 4096 characters is left out: every path inside it is
 * longer still, so no adapter writes a new item there. Each entry is
 * normalized on its own first (that never joins), and the folder is built
 * only when its length is within the limit, so the work is linear in the
 * lengths of `dir` and the entries. Never throws.
 */
export function dictionaryFolders(
  dir: string,
  manifest: object | undefined,
): string[] {
  const data = field(manifest, 'data');
  const normalizedDir = normalizedOrNone(dir);
  if (normalizedDir === undefined) return [];
  const base = segmented(normalizedDir);
  const folders: string[] = [];
  for (const entry of dictionaryEntries(data)) {
    const folder = normalizedOrNone(entry);
    if (folder === undefined) continue;
    const joined = joinWithin(base, folder, MAX_FOLDER_LENGTH);
    if (joined !== undefined) folders.push(joined);
  }
  return folders;
}

const components = (path: string): string[] =>
  path === '' ? [] : path.split('/');

/**
 * The first of `folders` that holds `path` (normalized), as the message
 * names it (`.` for the opened folder), or `undefined`. The opened folder
 * and any folder above it (only `..` components) hold every path; any other
 * folder holds a path when its components, compared by key, are the path's
 * leading ones, so the path itself is not inside a folder of the same name.
 */
export function dictionaryFolderOf(
  path: string,
  folders: readonly string[],
): string | undefined {
  const parts = components(path);
  for (const folder of folders) {
    const leading = components(folder);
    // work-ok: the components of one dictionary folder path
    if (leading.every((part) => part === '..')) {
      return folder === '' ? '.' : folder;
    }
    if (leading.length >= parts.length) continue;
    let inside = true;
    for (let i = 0; i < leading.length && inside; i += 1) {
      inside = pathKey(leading[i]!) === pathKey(parts[i]!);
    }
    if (inside) return folder === '' ? '.' : folder;
  }
  return undefined;
}

/** What id selection asks about the file of a new entity or subject area. */
export interface FileSpace {
  /** The file a new item with this id gets. */
  fileOf(id: string): string;
  /** Reason 3: the dictionary folder holding the path, as the message names it. */
  dictionaryFolderOf(path: string): string | undefined;
  /** Reason 4: a path in use has the key of this one. */
  isUsed(path: string): boolean;
  /** Reason 5: the initial path to name when one differs from this only by key. */
  otherCase(path: string): string | undefined;
}

/** A `FileSpace` over sets: `used` answers for the keys of the paths in use. */
export function fileSpace(places: {
  dir: string;
  folder: NewItemFolder;
  used: { has(key: string): boolean };
  initial: InitialPaths;
  dictionaryFolders: readonly string[];
}): FileSpace {
  const { dir, folder, used, initial } = places;
  return {
    fileOf: (id) => newItemFile(dir, folder, id),
    dictionaryFolderOf: (path) =>
      dictionaryFolderOf(path, places.dictionaryFolders),
    isUsed: (path) => used.has(pathKey(path)),
    otherCase: (path) => initial.otherCase(path),
  };
}

/**
 * Everything directly under `entities/` and `subject-areas/` of the model
 * folder `modelDir`, files and folders, those of the model included (spec
 * FR-06), in code unit order. Lists each folder once; an adapter error
 * passes through.
 */
export async function listReservedFiles(
  fs: FileSystemAdapter,
  modelDir: string,
): Promise<string[]> {
  const found: string[] = [];
  for (const folder of ['entities', 'subject-areas'] as const) {
    const under = joinPath(modelDir, folder);
    for (const entry of await fs.list(under)) {
      found.push(joinPath(under, entry.name));
    }
  }
  return found.sort(compareCodeUnits); // work-ok: listReservedFiles, called by the caller before an editor exists
}
