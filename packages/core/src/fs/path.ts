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
