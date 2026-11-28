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
 * has. Throws only `TypeError(NOT_A_LIST)`: for a non-array, a non-string
 * entry, or a value whose reading throws.
 */
export function reservedPaths(
  reservedFiles: unknown,
  initial: InitialPaths,
): string[] {
  const files: string[] = [];
  try {
    if (!Array.isArray(reservedFiles)) throw new TypeError(NOT_A_LIST);
    const list: readonly unknown[] = reservedFiles;
    const length = list.length;
    for (let i = 0; i < length; i += 1) {
      const file = list[i];
      if (typeof file !== 'string') throw new TypeError(NOT_A_LIST);
      files.push(file);
    }
  } catch {
    throw new TypeError(NOT_A_LIST);
  }
  const kept = new Set<string>();
  for (const file of files) {
    const path = normalizePath(file);
    if (path !== '' && !initial.has(path)) kept.add(path);
  }
  return [...kept]; // work-ok: the reserved paths, once when the editor is made
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
