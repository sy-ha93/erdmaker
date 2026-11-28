import { compareCodeUnits } from '../compare.js';
import type { FileSystemAdapter } from '../fs/adapter.js';
import { joinPath, normalizePath } from '../fs/path.js';
import { isAbsoluteEntry } from '../validate/manifest.js';

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
  // work-ok: the reserved paths, once when the editor is made
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
    // work-ok: the initial or reserved paths, once when the editor is made
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

/** No array is longer; only a Proxy says so (as for the model lists, FR-01). */
const MAX_LIST_LENGTH = 2 ** 32 - 1;

/** `value`'s own data property `key`, or `none` when it has none or reading throws. */
const none: unique symbol = Symbol('none');
function ownData(value: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : none;
  } catch {
    return none;
  }
}

/**
 * The entries of `value` when it is an array whose `length` reads as a
 * whole number from 0 to `MAX_LIST_LENGTH` and every index below it is an
 * own data property that reads without throwing; `undefined` otherwise.
 * Reads `length` before any index, looks at each index's descriptor before
 * reading it (an accessor is never called), and stops at the first index
 * that fails, so the work is linear in the entries there are. Never throws.
 */
function ownEntries(value: unknown): unknown[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const list: readonly unknown[] = value;
    const length = list.length;
    if (
      typeof length !== 'number' ||
      !Number.isInteger(length) ||
      length < 0 ||
      length > MAX_LIST_LENGTH
    ) {
      return undefined;
    }
    const entries: unknown[] = [];
    for (let i = 0; i < length; i += 1) {
      if (ownData(list, String(i)) === none) return undefined;
      entries.push(list[i]);
    }
    return entries;
  } catch {
    return undefined; // a revoked Proxy, or a trap that throws
  }
}

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
  const entries = ownEntries(reservedFiles);
  if (entries === undefined) throw new TypeError(NOT_A_LIST);
  const files: string[] = [];
  // work-ok: the reserved paths, once when the editor is made
  for (const file of entries) {
    if (typeof file !== 'string') throw new TypeError(NOT_A_LIST);
    files.push(file);
  }
  const kept = new Set<string>();
  // work-ok: the initial or reserved paths, once when the editor is made
  for (const file of files) {
    const path = normalizePath(file);
    if (path !== '' && !initial.has(path)) kept.add(path);
  }
  return [...kept]; // work-ok: the reserved paths, once when the editor is made
}

/**
 * The `dictionaries` of a manifest item (spec FR-06), read without calling a
 * getter and never throwing: `undefined` (the default folder) when there is
 * no manifest or its `data` is an object without its own `dictionaries`;
 * the string entries when `dictionaries` is a list (`ownEntries`); for
 * anything else (a getter or a throwing trap on `data` or `dictionaries`,
 * a value that is not such a list, a hole) none, `[]`: no dictionary folder.
 */
export function manifestDictionaries(
  manifest: object | undefined,
): string[] | undefined {
  if (manifest === undefined) return undefined;
  const data = ownData(manifest, 'data');
  if (typeof data !== 'object' || data === null) return [];
  let has: boolean;
  try {
    has = Object.getOwnPropertyDescriptor(data, 'dictionaries') !== undefined;
  } catch {
    return [];
  }
  if (!has) return undefined;
  const entries = ownEntries(ownData(data, 'dictionaries'));
  const kept: string[] = [];
  // work-ok: the manifest's dictionaries, once when the editor is made
  for (const entry of entries ?? []) {
    if (typeof entry === 'string') kept.push(entry);
  }
  return kept;
}

/**
 * The dictionary folders of a model (spec FR-06): the manifest's
 * `dictionaries`, else `dictionary`, absolute entries left out, each joined
 * to the model folder and normalized. The opened folder itself is `""`.
 */
export function dictionaryFolders(
  dir: string,
  dictionaries: readonly string[] | undefined,
): string[] {
  const folders: string[] = [];
  // work-ok: the manifest's dictionaries, once when the editor is made
  for (const entry of dictionaries ?? ['dictionary']) {
    if (!isAbsoluteEntry(entry)) folders.push(joinPath(dir, entry));
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
  // work-ok: the dictionary folders of the manifest: a few, not the model
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
    // work-ok: listReservedFiles, called by the caller before an editor exists
    for (const entry of await fs.list(under)) {
      found.push(joinPath(under, entry.name));
    }
  }
  return found.sort(compareCodeUnits); // work-ok: listReservedFiles, called by the caller before an editor exists
}
