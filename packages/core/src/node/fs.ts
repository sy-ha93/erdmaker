import { constants, type Stats } from 'node:fs';
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  readdir,
  unlink,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  FileNotFoundError,
  type FileEntry,
  type FileSystemAdapter,
} from '../fs/adapter.js';
import { normalizePath } from '../fs/path.js';

// Windows has neither; the checks around each open stand in.
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const O_NONBLOCK = constants.O_NONBLOCK ?? 0;

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined;
}

/**
 * Errors that say the path cannot name an existing file: nothing there
 * (ENOENT), a file where the path needs a folder (ENOTDIR), or a path or
 * name longer than the system allows (ENAMETOOLONG).
 */
function isMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENAMETOOLONG';
}

/** Too many links to resolve, or a link where `O_NOFOLLOW` allows none. */
const isLoop = (error: unknown) => errorCode(error) === 'ELOOP';

/**
 * No file's path holds a NUL character; Node rejects such a path outright.
 * On Windows a backslash separates folders, and the core only knows `/`.
 */
const impossible = (path: string) =>
  path.includes('\0') || (process.platform === 'win32' && path.includes('\\'));

/** The longest name a folder entry can have: 255 UTF-16 units on Windows, 255 bytes elsewhere. */
const tooLong = (name: string) =>
  process.platform === 'win32'
    ? name.length > 255
    : new TextEncoder().encode(name).length > 255;

/** Why `path` cannot be written whatever is on disk, before any folder is made. */
function badPath(path: string): TypeError | undefined {
  if (path.includes('\0')) {
    return new TypeError(`A path cannot hold a NUL character: ${path}`);
  }
  if (process.platform === 'win32' && path.includes('\\')) {
    return new TypeError(`A path cannot hold a backslash on Windows: ${path}`);
  }
  const long = path.split('/').find(tooLong);
  if (long !== undefined) {
    return new TypeError(
      `Cannot write ${path}: the name ${long} is longer than 255 bytes`,
    );
  }
  return undefined;
}

/**
 * The most folders a path may name below the opened folder (or below the
 * folder its leading `..` climb to). Each call looks at each of them with
 * one `lstat`, so a call costs a bounded number of system calls.
 */
export const MAX_PATH_DEPTH = 32;

/** The longest path string the adapter looks at; longer ones are impossible. */
const MAX_PATH_LENGTH = 4096;

/** A path in a message, cut to 200 characters. */
const shown = (path: string) =>
  path.length > 200 ? `${path.slice(0, 200)}…` : path;

/** An adapter path split below the folder it climbs to. */
interface Located {
  /** The opened folder, or the folder its leading `..` climb to; used as given. */
  base: string;
  /** The folders below `base`, then the last entry; none may be a symbolic link. */
  names: string[];
}

/** What one folder walk found. */
type Walk =
  { found: 'folder'; path: string } | { found: 'link' | 'missing' | 'file' };

/** What `stat` and `lstat` say an entry is. */
interface EntryType {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  isFIFO(): boolean;
  isSocket(): boolean;
  isBlockDevice(): boolean;
  isCharacterDevice(): boolean;
}

/** Whether the type is known: some filesystems give `readdir` no type. */
const known = (type: EntryType) =>
  type.isFile() ||
  type.isDirectory() ||
  type.isSymbolicLink() ||
  type.isFIFO() ||
  type.isSocket() ||
  type.isBlockDevice() ||
  type.isCharacterDevice();

/** `lstat`, or `undefined` when nothing is there. */
async function entryAt(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

/**
 * Walks `folders` below `base` one name at a time with `lstat`, never
 * through a symbolic link: the first name that is a link, missing, or not a
 * folder ends the walk. A missing or looping name reads as `missing`; any
 * other failure rejects.
 */
async function walkFolders(
  base: string,
  folders: readonly string[],
): Promise<Walk> {
  let path = base;
  for (const name of folders) {
    path = join(path, name);
    let entry: Stats;
    try {
      entry = await lstat(path);
    } catch (error) {
      if (isMissing(error) || isLoop(error)) return { found: 'missing' };
      throw error;
    }
    if (entry.isSymbolicLink()) return { found: 'link' };
    if (!entry.isDirectory()) return { found: 'file' };
  }
  return { found: 'folder', path };
}

/**
 * `walkFolders` for a write: a missing folder is made, one at a time, and
 * so are the ones after it. A non-folder ends the walk with `file`; a
 * failure other than a missing name rejects with the system's error.
 */
async function makeFolders(
  base: string,
  folders: readonly string[],
): Promise<Walk> {
  // The opened folder (or the one `..` climbs to) is made as given, links allowed.
  await mkdir(base, { recursive: true });
  let path = base;
  let making = false;
  for (const name of folders) {
    path = join(path, name);
    let entry: Stats | undefined;
    if (!making) {
      try {
        entry = await lstat(path);
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
      }
    }
    if (!entry) {
      try {
        await mkdir(path);
        making = true;
        continue;
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error;
        // Made by someone else since: looked at as any folder that is there.
        entry = await lstat(path);
      }
    }
    if (entry.isSymbolicLink()) return { found: 'link' };
    if (!entry.isDirectory()) return { found: 'file' };
  }
  return { found: 'folder', path };
}

/** The type of each entry by name, `lstat` for each; entries gone since are left out. */
async function typesByName(
  folder: string,
  names: readonly string[],
): Promise<[string, EntryType][]> {
  const typed: [string, EntryType][] = [];
  for (const name of names) {
    const type = await entryAt(join(folder, name));
    if (type) typed.push([name, type]);
  }
  return typed;
}

/**
 * An adapter over the folder `rootDir` (resolved against the current directory).
 *
 * Symbolic links below the opened folder are never followed (as in the
 * browser, whose folder access shows none): `list` leaves them out, and each
 * call looks at the folders of its path below the opened folder and at its
 * last entry one at a time with `lstat`, without passing a link. A path
 * whose folders or last entry include a link is missing (`readText` rejects
 * with `FileNotFoundError`, `list` is empty, `remove` does nothing) or, for
 * `writeText`, refused with `Cannot write <path>: a folder on its way is a
 * symbolic link` (`…: it is a symbolic link` for the last entry) before
 * anything is made. The opened folder itself is used as given (it may be a
 * link or be reached through links, and it is made for a write when
 * missing), and so is the folder a leading `..` climbs to; the names after
 * it may not be links. `readText` reads regular files only: a folder, FIFO,
 * socket or device is missing and is not opened. A path that cannot exist
 * (longer than 4096 characters, more than `MAX_PATH_DEPTH` folders below
 * the folder it climbs to, a NUL character, on Windows a backslash) is
 * read, listed and removed as a missing one, and refused by `writeText`
 * before any folder is made. The adapter keeps nothing between calls. The
 * checks and the call that follows them are not one step: a link put in
 * place between the two is followed (a known limit).
 */
export function createNodeFileSystem(rootDir: string): FileSystemAdapter {
  const root = resolve(rootDir);
  /** The path split below the folder it climbs to, or `undefined` when no file can have it. */
  const locate = (path: string, folderOnly: boolean): Located | undefined => {
    // Bounded first, so splitting and joining it stay cheap.
    if (path.length > MAX_PATH_LENGTH || impossible(path)) return undefined;
    const segments = normalizePath(path).split('/').filter(Boolean);
    let up = 0;
    while (segments[up] === '..') up += 1;
    const names = segments.slice(up);
    const folders = folderOnly ? names.length : names.length - 1;
    if (folders > MAX_PATH_DEPTH) return undefined;
    const base = up === 0 ? root : join(root, segments.slice(0, up).join('/'));
    return { base, names };
  };

  return {
    async readText(path) {
      const located = locate(path, false);
      if (!located) throw new FileNotFoundError(path);
      const { base, names } = located;
      let handle: FileHandle | undefined;
      try {
        const walk = await walkFolders(base, names.slice(0, -1));
        if (walk.found !== 'folder') throw new FileNotFoundError(path);
        const full = join(walk.path, names.at(-1) ?? '');
        const entry = await lstat(full);
        if (!entry.isFile()) throw new FileNotFoundError(path);
        handle = await open(full, constants.O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
        // Replaced since `lstat`: still only a regular file is read.
        if (!(await handle.stat()).isFile()) throw new FileNotFoundError(path);
        return await handle.readFile('utf8');
      } catch (error) {
        if (error instanceof FileNotFoundError) throw error;
        if (isMissing(error) || isLoop(error)) {
          throw new FileNotFoundError(path, { cause: error });
        }
        throw error;
      } finally {
        await handle?.close();
      }
    },

    async writeText(path, text) {
      if (path.length > MAX_PATH_LENGTH) {
        throw new TypeError(
          `Cannot write ${shown(path)}: its path is longer than ${MAX_PATH_LENGTH} characters`,
        );
      }
      const bad = badPath(path);
      if (bad) throw bad;
      const located = locate(path, false);
      if (!located) {
        throw new TypeError(
          `Cannot write ${shown(path)}: its path has more than ${MAX_PATH_DEPTH} folders`,
        );
      }
      const { base, names } = located;
      const walk = await makeFolders(base, names.slice(0, -1));
      if (walk.found === 'link') {
        throw new Error(
          `Cannot write ${path}: a folder on its way is a symbolic link`,
        );
      }
      // Past a file where a folder is needed, the system names the failure.
      const full =
        walk.found === 'folder'
          ? join(walk.path, names.at(-1) ?? '')
          : join(base, names.join('/'));
      const isLink = () =>
        new Error(`Cannot write ${path}: it is a symbolic link`);
      if ((await entryAt(full))?.isSymbolicLink()) throw isLink();
      let handle: FileHandle;
      try {
        handle = await open(
          full,
          constants.O_WRONLY | constants.O_CREAT | O_NOFOLLOW | O_NONBLOCK,
          0o666,
        );
      } catch (error) {
        if (isLoop(error)) throw isLink();
        throw error;
      }
      try {
        if (!(await handle.stat()).isFile()) {
          throw new Error(`Cannot write ${path}: it is not a file`);
        }
        await handle.truncate(0);
        await handle.writeFile(text, 'utf8');
      } finally {
        await handle.close();
      }
    },

    async list(dir) {
      const located = locate(dir, true);
      if (!located) return [];
      const walk = await walkFolders(located.base, located.names);
      if (walk.found !== 'folder') return [];
      const full = walk.path;
      let typed: [string, EntryType][];
      try {
        typed = (await readdir(full, { withFileTypes: true })).map(
          (dirent): [string, EntryType] => [dirent.name, dirent],
        );
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') {
          if (isMissing(error)) return [];
          throw error;
        }
        // A typed listing looks at an entry the filesystem gives no type
        // itself, and fails as a whole when that entry is gone by then.
        // Listed by name, the entries still there are looked at one by one.
        let entryNames: string[];
        try {
          entryNames = await readdir(full);
        } catch (again) {
          if (isMissing(again)) return [];
          throw again;
        }
        typed = await typesByName(full, entryNames);
      }
      const entries: FileEntry[] = [];
      for (const [name, given] of typed) {
        // An entry removed since `readdir` is left out like any missing one.
        const type = known(given) ? given : await entryAt(join(full, name));
        if (type?.isFile()) entries.push({ name, kind: 'file' });
        else if (type?.isDirectory()) entries.push({ name, kind: 'directory' });
      }
      return entries;
    },

    async remove(path) {
      const located = locate(path, false);
      if (!located) return;
      const { base, names } = located;
      const walk = await walkFolders(base, names.slice(0, -1));
      if (walk.found !== 'folder') return;
      const full = join(walk.path, names.at(-1) ?? '');
      const entry = await entryAt(full);
      if (!entry || entry.isSymbolicLink()) return;
      try {
        await unlink(full);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    },
  };
}
