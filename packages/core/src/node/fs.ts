import {
  mkdir,
  readdir,
  readFile,
  stat,
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

// ENOTDIR means a file sits where the path needs a folder, so the target cannot exist.
function isMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** An adapter over the folder `rootDir` (resolved against the current directory). */
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
      for (const dirent of dirents) {
        let kind: FileEntry['kind'] | undefined;
        if (dirent.isFile()) kind = 'file';
        else if (dirent.isDirectory()) kind = 'directory';
        else if (dirent.isSymbolicLink()) {
          const target = await stat(join(folder, dirent.name)).catch(
            () => undefined,
          );
          if (target?.isFile()) kind = 'file';
          else if (target?.isDirectory()) kind = 'directory';
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
