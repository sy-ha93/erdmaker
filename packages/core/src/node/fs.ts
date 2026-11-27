import {
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';
import {
  FileNotFoundError,
  type FileEntry,
  type FileSystemAdapter,
} from '../fs/adapter.js';
import { joinPath, normalizePath } from '../fs/path.js';

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

/** Whether `outer` is `inner` or one of the folders that hold it (both real paths). */
function holds(outer: string, inner: string): boolean {
  if (outer === inner) return true;
  return inner.startsWith(outer.endsWith(sep) ? outer : outer + sep);
}

/** As many links as Linux follows in one path before ELOOP. */
const MAX_LINKS = 40;

function loopError(path: string): Error {
  return Object.assign(
    new Error(`ELOOP: too many symbolic links encountered, '${path}'`),
    { code: 'ELOOP', path },
  );
}

/**
 * The real path of the link `name` in the folder whose real path is `folder`,
 * found as `realpath` finds it: one segment at a time from a real path, `..`
 * taken on the real path, each link read and its target walked in turn. A
 * few system calls per segment of the link's target, whatever the depth,
 * where `realpath` looks again at every folder of the path. On Linux only,
 * where `realpath` is exactly this; elsewhere it is `realpath`.
 */
async function linkTarget(folder: string, name: string): Promise<string> {
  if (process.platform !== 'linux') return realpath(join(folder, name));
  let current = folder;
  // Segments still to walk, the next one last.
  const rest = [name];
  let links = 0;
  for (let segment = rest.pop(); segment !== undefined; segment = rest.pop()) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      current = dirname(current);
      continue;
    }
    const next = join(current, segment);
    if (!(await lstat(next)).isSymbolicLink()) {
      current = next;
      continue;
    }
    links += 1;
    if (links > MAX_LINKS) throw loopError(next);
    const target = await readlink(next);
    if (isAbsolute(target)) current = parse(resolve(target)).root;
    const segments = target.split('/');
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      rest.push(segments[i] ?? '');
    }
  }
  return current;
}

/**
 * A folder a listing was reached through, as the walk named it. Its real
 * path is worked out at most once, from its parent's.
 */
interface Folder {
  /** The folder the walk listed to find this one; none for the walk's first. */
  parent: Folder | undefined;
  /** Its name in `parent`, or for the first folder its path from the root. */
  name: string;
  /**
   * Whether the name is a symbolic link (its real path is the target's, not
   * the parent's real path plus the name); `undefined` until looked at.
   */
  link: boolean | undefined;
  real?: string;
  /**
   * The real paths, other than `real`, of the folders on the way here that
   * a link was followed out of. The others hold `real` or one of these, so
   * a link holds a folder on the way exactly when it holds one of these.
   */
  passed?: readonly string[];
}

/**
 * An adapter over the folder `rootDir` (resolved against the current directory).
 *
 * `list` follows symbolic links, except a link to a folder that the listed
 * folder was reached through (itself or a folder above it, by real path):
 * following that one would walk the same folders forever. A link whose
 * target does not exist is left out; any other failure to look at a link
 * rejects. A path that cannot exist (too long, or with a NUL character) is
 * read, listed and removed as a missing one.
 *
 * Each listing remembers the folders it returns until they are listed, so
 * that a walk works out each folder's real path once, from its parent's.
 */
export function createNodeFileSystem(rootDir: string): FileSystemAdapter {
  const root = resolve(rootDir);
  const full = (path: string) => join(root, normalizePath(path));
  /** Folders returned by a listing and not listed since, by normalized path. */
  const returned = new Map<string, Folder>();

  /** The folders of `path` (normalized) when no listing returned it. */
  const startFolder = (path: string): Folder => {
    const segments = path === '' ? [] : path.split('/');
    let start = 0;
    while (segments[start] === '..') start += 1;
    let folder: Folder = {
      parent: undefined,
      name: segments.slice(0, start).join('/'),
      link: false,
    };
    for (const name of segments.slice(start)) {
      folder = { parent: folder, name, link: undefined };
    }
    return folder;
  };

  /** Works out the real path of `folder` and of the folders it was reached through. */
  const realOf = async (
    folder: Folder,
  ): Promise<{ real: string; passed: readonly string[] }> => {
    const pending: Folder[] = [];
    let known: Folder | undefined = folder;
    while (known && known.real === undefined) {
      pending.push(known);
      known = known.parent;
    }
    for (let next = pending.pop(); next; next = pending.pop()) {
      const parent = next.parent;
      if (!parent) {
        next.real = await realpath(join(root, next.name));
        next.passed = [];
        continue;
      }
      // Set, since parents are worked out first.
      const above = parent.real ?? '';
      const passed = parent.passed ?? [];
      next.link ??=
        process.platform !== 'linux' ||
        (await lstat(join(above, next.name))).isSymbolicLink();
      next.real = next.link
        ? await linkTarget(above, next.name)
        : join(above, next.name);
      next.passed = next.link ? [above, ...passed] : passed;
    }
    return { real: folder.real ?? '', passed: folder.passed ?? [] };
  };

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
      const key = normalizePath(dir);
      const here = returned.get(key) ?? startFolder(key);
      returned.delete(key);
      const folder = join(root, key);
      let dirents;
      try {
        dirents = await readdir(folder, { withFileTypes: true });
      } catch (error) {
        if (isMissing(error)) return [];
        throw error;
      }
      const entries: FileEntry[] = [];
      for (const dirent of dirents) {
        const name = dirent.name;
        if (dirent.isFile()) entries.push({ name, kind: 'file' });
        else if (dirent.isDirectory()) {
          entries.push({ name, kind: 'directory' });
          returned.set(joinPath(key, name), {
            parent: here,
            name,
            link: false,
          });
        } else if (dirent.isSymbolicLink()) {
          // Only a dangling link is left out; ELOOP, EACCES and the rest reject.
          const target = await stat(join(folder, name)).catch(
            (error: unknown) => {
              if (isMissing(error)) return undefined;
              throw error;
            },
          );
          if (!target) continue;
          if (target.isFile()) entries.push({ name, kind: 'file' });
          else if (target.isDirectory()) {
            const { real, passed } = await realOf(here);
            const linked = await linkTarget(real, name);
            if (holds(linked, real) || passed.some((p) => holds(linked, p))) {
              continue;
            }
            entries.push({ name, kind: 'directory' });
            returned.set(joinPath(key, name), {
              parent: here,
              name,
              link: true,
              real: linked,
              passed: [real, ...passed],
            });
          }
        }
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
