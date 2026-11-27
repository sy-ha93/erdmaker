import {
  mkdir,
  readdir,
  readFile,
  realpath,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
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

// ENOTDIR means a file sits where the path needs a folder, so the target cannot exist.
function isMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Whether `outer` is `inner` or one of the folders that hold it (both real paths). */
function holds(outer: string, inner: string): boolean {
  if (outer === inner) return true;
  return inner.startsWith(outer.endsWith(sep) ? outer : outer + sep);
}

/**
 * The real paths of the folder `path` (normalized, relative to `root`) and of
 * each folder on the way to it: the folders a walk has passed through to
 * reach it. A path that starts with `..` starts at the folder it climbs to.
 * One `realpath` per folder, and only for a listing that has a folder link.
 */
async function walkedFolders(root: string, path: string): Promise<string[]> {
  const segments = path === '' ? [] : path.split('/');
  let start = 0;
  while (segments[start] === '..') start += 1;
  const folders: string[] = [];
  for (let end = start; end <= segments.length; end += 1) {
    folders.push(await realpath(join(root, ...segments.slice(0, end))));
  }
  return folders;
}

/**
 * An adapter over the folder `rootDir` (resolved against the current directory).
 *
 * `list` follows symbolic links, except a link to a folder that the listed
 * folder was reached through (itself or a folder above it, by real path):
 * following that one would walk the same folders forever. A link whose
 * target does not exist is left out; any other failure to look at a link
 * rejects.
 */
export function createNodeFileSystem(rootDir: string): FileSystemAdapter {
  const root = resolve(rootDir);
  const full = (path: string) => join(root, normalizePath(path));

  return {
    async readText(path) {
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
      const folder = full(dir);
      let dirents;
      try {
        dirents = await readdir(folder, { withFileTypes: true });
      } catch (error) {
        if (isMissing(error)) return [];
        throw error;
      }
      const entries: FileEntry[] = [];
      // Looked up once per listing, and only when a link to a folder needs it.
      let walked: string[] | undefined;
      for (const dirent of dirents) {
        let kind: FileEntry['kind'] | undefined;
        if (dirent.isFile()) kind = 'file';
        else if (dirent.isDirectory()) kind = 'directory';
        else if (dirent.isSymbolicLink()) {
          const link = join(folder, dirent.name);
          // Only a dangling link is left out; ELOOP, EACCES and the rest reject.
          const target = await stat(link).catch((error: unknown) => {
            if (isMissing(error)) return undefined;
            throw error;
          });
          if (!target) continue;
          if (target.isFile()) kind = 'file';
          else if (target.isDirectory()) {
            walked ??= await walkedFolders(root, normalizePath(dir));
            const real = await realpath(link);
            if (!walked.some((passed) => holds(real, passed))) {
              kind = 'directory';
            }
          }
        }
        if (kind) entries.push({ name: dirent.name, kind });
      }
      return entries;
    },

    async remove(path) {
      try {
        await unlink(full(path));
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    },
  };
}
