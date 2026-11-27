/**
 * Normalizes a `/`-separated relative path: drops empty and `.` segments and
 * resolves `..` against earlier segments. A `..` that has nothing to cancel
 * stays at the front, so a path may point outside the opened folder.
 */
export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..' && out.length > 0 && out[out.length - 1] !== '..') {
      out.pop();
    } else {
      out.push(segment);
    }
  }
  return out.join('/');
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.join('/'));
}

const splitPath = (path: string) => (path === '' ? [] : path.split('/'));

/**
 * `to` relative to the folder `from`, both relative to the same folder:
 * `relativePath('m', 'dictionary/a.yaml')` is `../dictionary/a.yaml`. When
 * `from` climbs out of that folder further than `to` does, the way back in
 * cannot be named, and `to` comes back normalized but otherwise unchanged.
 */
export function relativePath(from: string, to: string): string {
  const base = splitPath(normalizePath(from));
  const target = splitPath(normalizePath(to));
  let shared = 0;
  while (
    shared < base.length &&
    shared < target.length &&
    base[shared] === target[shared]
  ) {
    shared += 1;
  }
  const up = base.slice(shared);
  if (up.includes('..')) return target.join('/');
  return [...up.map(() => '..'), ...target.slice(shared)].join('/');
}
