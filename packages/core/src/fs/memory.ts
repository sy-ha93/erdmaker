import { compareCodeUnits } from '../compare.js';
import {
  FileNotFoundError,
  type FileEntry,
  type FileSystemAdapter,
} from './adapter.js';
import { normalizePath } from './path.js';

/** No file's path holds a NUL character, on disk or here. */
function nulError(path: string): TypeError {
  return new TypeError(`A path cannot hold a NUL character: ${path}`);
}

/**
 * An adapter over an in-memory map of `path → text`. Folders exist only as
 * prefixes of file paths. Paths may start with `..`. As on disk, no file has
 * a NUL character in its path: such a path is read, listed and removed as a
 * missing one, and writing it, or passing it in `files`, fails. Paths are not
 * limited in length.
 */
export function createMemoryFileSystem(
  files: Readonly<Record<string, string>> = {},
): FileSystemAdapter {
  const store = new Map<string, string>();
  for (const [path, text] of Object.entries(files)) {
    if (path.includes('\0')) throw nulError(path);
    store.set(normalizePath(path), text);
  }

  const isDirectory = (path: string): boolean => {
    const prefix = path === '' ? '' : `${path}/`;
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  };

  const fileAncestor = (path: string): string | undefined => {
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i += 1) {
      const ancestor = segments.slice(0, i).join('/');
      if (store.has(ancestor)) return ancestor;
    }
    return undefined;
  };

  return {
    async readText(path) {
      const key = normalizePath(path);
      const text = store.get(key);
      if (text !== undefined) return text;
      if (isDirectory(key)) throw new Error(`Is a directory: ${path}`);
      throw new FileNotFoundError(path);
    },

    async writeText(path, text) {
      if (path.includes('\0')) throw nulError(path);
      const key = normalizePath(path);
      if (key === '' || (!store.has(key) && isDirectory(key))) {
        throw new Error(`Is a directory: ${path}`);
      }
      const blocker = fileAncestor(key);
      if (blocker !== undefined) {
        throw new Error(`Not a directory: ${blocker}`);
      }
      store.set(key, text);
    },

    async list(dir) {
      const key = normalizePath(dir);
      const prefix = key === '' ? '' : `${key}/`;
      const kinds = new Map<string, FileEntry['kind']>();
      for (const path of store.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length).split('/');
        const name = rest[0];
        // `..` is how paths outside the opened folder are written, not a child folder.
        if (name === undefined || name === '..') continue;
        kinds.set(name, rest.length === 1 ? 'file' : 'directory');
      }
      return [...kinds]
        .sort(([a], [b]) => compareCodeUnits(a, b))
        .map(([name, kind]) => ({ name, kind }));
    },

    async remove(path) {
      const key = normalizePath(path);
      if (store.delete(key)) return;
      if (isDirectory(key)) throw new Error(`Is a directory: ${path}`);
    },
  };
}
