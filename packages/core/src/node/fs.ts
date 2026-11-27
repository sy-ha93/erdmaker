import { constants, type Stats } from 'node:fs';
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  readdir,
  readlink,
  realpath,
  unlink,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  FileNotFoundError,
  type FileEntry,
  type FileSystemAdapter,
} from '../fs/adapter.js';
import { normalizePath } from '../fs/path.js';

// Windows has none of these three; the checks around each open stand in.
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const O_NONBLOCK = constants.O_NONBLOCK ?? 0;
const O_DIRECTORY = constants.O_DIRECTORY ?? 0;

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

/** Folders and the last entry of an adapter path, below the folder it climbs to. */
interface Located {
  /** The opened folder, or the folder its leading `..` climb to (joined, not resolved). */
  base: string;
  /** The names below `base`; none of them may be a symbolic link. */
  names: string[];
  /** `base` and `names` joined. */
  full: string;
}

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
 * The folder's path with every link resolved, at a cost that does not grow
 * with the number of folders in it. `realpath` looks at every folder of the
 * path, so a walk down a deep tree would take the cube of its depth; on
 * Linux the system names an open folder in one call instead.
 */
async function realFolder(path: string): Promise<string> {
  if (process.platform !== 'linux') return realpath(path);
  let handle: FileHandle;
  try {
    handle = await open(path, constants.O_RDONLY | O_DIRECTORY);
  } catch (error) {
    // A folder that can be passed through but not read: resolved by name.
    if (errorCode(error) === 'EACCES') return realpath(path);
    throw error;
  }
  try {
    return await readlink(`/proc/self/fd/${handle.fd}`);
  } catch {
    // No `/proc` mounted: resolved by name.
    return realpath(path);
  } finally {
    await handle.close();
  }
}

/**
 * Whether the folder `names` below `base` is reached without passing a
 * symbolic link, the last name included: the system resolves it to the same
 * place as `base` resolved, then `names` as written. `missing` when nothing
 * or a file is there. `base` itself may be or pass a link.
 */
async function linkFree(
  base: string,
  names: readonly string[],
): Promise<'yes' | 'link' | 'missing'> {
  if (names.length === 0) return 'yes';
  try {
    const [real, realBase] = await Promise.all([
      realFolder(join(base, ...names)),
      realpath(base),
    ]);
    return real === join(realBase, ...names) ? 'yes' : 'link';
  } catch (error) {
    if (isLoop(error)) return 'link';
    if (isMissing(error)) return 'missing';
    throw error;
  }
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
 * browser, whose folder access shows none): `list` leaves them out, and a
 * path whose folders or last entry below the opened folder include a link is
 * missing (`readText` rejects with `FileNotFoundError`, `list` is empty,
 * `remove` does nothing) or, for `writeText`, refused with `Cannot write
 * <path>: a folder on its way is a symbolic link` (`…: it is a symbolic
 * link` for the last entry) before anything is made. The opened folder
 * itself may be a link or be reached through links, and so may the folder a
 * leading `..` climbs to; the names after it may not. `readText` reads
 * regular files only: a folder, FIFO, socket or device is missing and is
 * not opened. A path that cannot exist (too long, a NUL character, on
 * Windows a backslash) is read, listed and removed as a missing one, and
 * refused by `writeText` before any folder is made. The adapter keeps
 * nothing between calls. The checks and the call that follows them are not
 * one step: a link put in place between the two is followed (a known limit).
 */
export function createNodeFileSystem(rootDir: string): FileSystemAdapter {
  const root = resolve(rootDir);
  const locate = (path: string): Located => {
    const segments = normalizePath(path).split('/').filter(Boolean);
    let up = 0;
    while (segments[up] === '..') up += 1;
    const base = join(root, ...segments.slice(0, up));
    const names = segments.slice(up);
    return { base, names, full: join(base, ...names) };
  };

  return {
    async readText(path) {
      if (impossible(path)) throw new FileNotFoundError(path);
      const { base, names, full } = locate(path);
      let handle: FileHandle | undefined;
      try {
        const entry = await lstat(full);
        if (
          !entry.isFile() ||
          (await linkFree(base, names.slice(0, -1))) !== 'yes'
        ) {
          throw new FileNotFoundError(path);
        }
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
      const bad = badPath(path);
      if (bad) throw bad;
      const { base, names, full } = locate(path);
      const onTheWay = () =>
        new Error(
          `Cannot write ${path}: a folder on its way is a symbolic link`,
        );
      // The deepest folder on the way that is there is checked; the ones
      // after it are made, so cannot be links.
      const folders = names.slice(0, -1);
      let there = folders.length;
      let entry: Stats | undefined;
      for (; there > 0; there -= 1) {
        entry = await entryAt(join(base, ...folders.slice(0, there)));
        if (entry) break;
      }
      if (entry?.isSymbolicLink()) throw onTheWay();
      if (
        entry?.isDirectory() &&
        (await linkFree(base, folders.slice(0, there))) === 'link'
      ) {
        throw onTheWay();
      }
      if (there < folders.length) {
        await mkdir(join(base, ...folders), { recursive: true });
      }
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
      if (impossible(dir)) return [];
      const { base, names, full } = locate(dir);
      if ((await linkFree(base, names)) !== 'yes') return [];
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
      if (impossible(path)) return;
      const { base, names, full } = locate(path);
      if ((await linkFree(base, names.slice(0, -1))) !== 'yes') return;
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
