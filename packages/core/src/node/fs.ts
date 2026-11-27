import {
  lstat,
  mkdir,
  readdir,
  readFile,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  FileNotFoundError,
  type FileEntry,
  type FileSystemAdapter,
} from '../fs/adapter.js';
import { normalizePath } from '../fs/path.js';

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

/** No file's path holds a NUL character; Node rejects such a path outright. */
const impossible = (path: string) => path.includes('\0');

/** What `readdir` or `lstat` says an entry is; neither follows a link. */
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

/**
 * An adapter over the folder `rootDir` (resolved against the current directory).
 *
 * `list` never returns a symbolic link, whatever it points to, so a walk does
 * not follow links (as in the browser, whose folder listing has none). The
 * root folder and paths given to `readText`, `writeText` and `remove` are
 * resolved by the system as usual, links included. A path that cannot exist
 * (too long, or with a NUL character) is read, listed and removed as a
 * missing one. The adapter keeps nothing between calls.
 */
export function createNodeFileSystem(rootDir: string): FileSystemAdapter {
  const root = resolve(rootDir);
  const full = (path: string) => join(root, normalizePath(path));

  return {
    async readText(path) {
      if (impossible(path)) throw new FileNotFoundError(path);
      try {
        return await readFile(full(path), 'utf8');
      } catch (error) {
        if (isMissing(error))
          throw new FileNotFoundError(path, { cause: error });
        throw error;
      }
    },

    async writeText(path, text) {
      const target = full(path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, text, 'utf8');
    },

    async list(dir) {
      if (impossible(dir)) return [];
      const folder = full(dir);
      let dirents;
      try {
        dirents = await readdir(folder, { withFileTypes: true });
      } catch (error) {
        if (isMissing(error)) return [];
        throw error;
      }
      const entries: FileEntry[] = [];
      for (const dirent of dirents) {
        let type: EntryType | undefined = dirent;
        if (!known(type)) {
          // An entry removed since `readdir` is left out like any missing one.
          type = await lstat(join(folder, dirent.name)).catch(
            (error: unknown) => {
              if (isMissing(error)) return undefined;
              throw error;
            },
          );
        }
        if (type?.isFile()) entries.push({ name: dirent.name, kind: 'file' });
        else if (type?.isDirectory())
          entries.push({ name: dirent.name, kind: 'directory' });
      }
      return entries;
    },

    async remove(path) {
      if (impossible(path)) return;
      try {
        await unlink(full(path));
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    },
  };
}
