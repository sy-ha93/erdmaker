import type { Issue } from '../model/types.js';
import { escapePointerToken } from '../parse/pointer.js';

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isJsonScalar(value: unknown): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return true;
    case 'number':
      // An integer-valued number must be exact, however it was written (`1e300` is rejected).
      return Number.isInteger(value)
        ? Number.isSafeInteger(value)
        : Number.isFinite(value);
    default:
      return false;
  }
}

/**
 * Finds every value that is not JSON data: anything other than null, a
 * boolean, a string, a finite number (integers within the safe range), an
 * array or a plain object. Shared references are fine; a cycle is reported
 * where it closes. Never throws, whatever `value` is.
 */
export function jsonValueIssues(file: string, value: unknown): Issue[] {
  const issues: Issue[] = [];
  const report = (path: string) =>
    issues.push({
      rule: 'schema',
      severity: 'error',
      file,
      path,
      message: `${path || '/'} must be a JSON value`,
    });

  // Only the objects on the current path, so a value reached twice is not a cycle.
  const ancestors = new Set<object>();

  const visit = (node: unknown, path: string): void => {
    if (isJsonScalar(node)) return;
    if (typeof node !== 'object' || node === null || ancestors.has(node)) {
      report(path);
      return;
    }
    let children: [string, PropertyDescriptor | undefined][];
    try {
      if (Array.isArray(node)) {
        children = Array.from({ length: node.length }, (_, i) => [
          String(i),
          Object.getOwnPropertyDescriptor(node, i),
        ]);
      } else if (isPlainObject(node)) {
        children = Object.keys(node).map((key) => [
          key,
          Object.getOwnPropertyDescriptor(node, key),
        ]);
      } else {
        report(path);
        return;
      }
    } catch {
      report(path);
      return;
    }
    ancestors.add(node);
    for (const [key, descriptor] of children) {
      const childPath = `${path}/${escapePointerToken(key)}`;
      // A missing descriptor is an array hole; an accessor is not data and is not called.
      if (descriptor === undefined || !('value' in descriptor)) {
        report(childPath);
      } else {
        visit(descriptor.value, childPath);
      }
    }
    ancestors.delete(node);
  };

  visit(value, '');
  return issues;
}
