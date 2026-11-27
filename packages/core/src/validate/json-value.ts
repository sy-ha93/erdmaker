import type { Issue } from '../model/types.js';
import { escapePointerToken } from '../parse/pointer.js';
import { MAX_NESTING } from '../parse/yaml.js';

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

// A canonical array index: `0` or a decimal without leading zeros.
const ARRAY_INDEX = /^(?:0|[1-9]\d*)$/;

/** What one container holds: its entries in order, and where its first hole is. */
interface Children {
  entries: [string, PropertyDescriptor | undefined][];
  hole?: number;
}

/** The entries of an array of this realm (a subclass instance is a class instance). */
function arrayChildren(node: unknown[]): Children {
  // Own keys, not every index, so a sparse array of any length stays cheap.
  const indices = Object.getOwnPropertyNames(node)
    .filter((key) => ARRAY_INDEX.test(key))
    .map(Number)
    .filter((index) => index < node.length)
    .sort((a, b) => a - b);
  const entries = indices.map(
    (index): [string, PropertyDescriptor | undefined] => [
      String(index),
      Object.getOwnPropertyDescriptor(node, index),
    ],
  );
  if (indices.length === node.length) return { entries };
  const gap = indices.findIndex((index, position) => index !== position);
  return { entries, hole: gap === -1 ? indices.length : gap };
}

function objectChildren(node: object): Children {
  return {
    entries: Object.keys(node).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(node, key),
    ]),
  };
}

/** One container being walked: the next entry to visit is `entries[next]`. */
interface Frame extends Children {
  node: object;
  path: string;
  next: number;
}

/** The values in some data that are not JSON data, and whether the data is safe to read as data. */
export interface JsonValueCheck {
  issues: Issue[];
  /**
   * False when reading the data as plain data may not end or may run code:
   * a cycle, a sparse array, an accessor, a class instance (Proxies that do
   * not pass for plain objects included) or a container that throws when
   * looked at. Other values that are not JSON (`undefined`, a function, a
   * symbol, a bigint, a number JSON cannot hold) leave it true; data read
   * from a file is always readable.
   */
  readable: boolean;
  /**
   * JSON data a file cannot hold: the first collection, in key order, more
   * than `MAX_NESTING` levels deep, counting the data itself as level 1 as
   * the readers count a file's root and `serializeModel` counts what it
   * writes. Worded `<path> is nested more than 256 levels deep`. One per
   * data however many collections are that deep; not in `issues`.
   */
  tooDeep?: Issue;
}

/**
 * Finds every value that is not JSON data: anything other than null, a
 * boolean, a string, a finite number (integers within the safe range), an
 * array or a plain object. Shared references are fine; a cycle is reported
 * where it closes. The holes of a sparse array are one issue, at the first
 * hole. Never throws, whatever `value` is, however deeply it nests.
 */
export function jsonValueIssues(file: string, value: unknown): Issue[] {
  return checkJsonValue(file, value).issues;
}

/**
 * `jsonValueIssues`, whether the data is safe to give to code that reads it
 * as data, and whether it nests deeper than a file may hold. One walk with an
 * explicit stack: linear in the data, without recursion.
 */
export function checkJsonValue(file: string, value: unknown): JsonValueCheck {
  const issues: Issue[] = [];
  let readable = true;
  let tooDeep: Issue | undefined;
  const report = (path: string, unreadable = false) => {
    if (unreadable) readable = false;
    issues.push({
      rule: 'schema',
      severity: 'error',
      file,
      path,
      message: `${path || '/'} must be a JSON value`,
    });
  };

  // Only the objects on the current path, so a value reached twice is not a cycle.
  const ancestors = new Set<object>();
  // An explicit stack instead of recursion: any depth fits.
  const stack: Frame[] = [];

  /** Reports `node` or, for a container, starts walking it. */
  const enter = (node: unknown, path: string): void => {
    if (isJsonScalar(node)) return;
    if (typeof node !== 'object' || node === null) {
      report(path);
      return;
    }
    if (ancestors.has(node)) {
      report(path, true);
      return;
    }
    let children: Children;
    try {
      if (
        Array.isArray(node) &&
        Object.getPrototypeOf(node) === Array.prototype
      ) {
        children = arrayChildren(node as unknown[]);
      } else if (!Array.isArray(node) && isPlainObject(node)) {
        children = objectChildren(node);
      } else {
        report(path, true);
        return;
      }
    } catch {
      report(path, true);
      return;
    }
    // `node` is at level `stack.length + 1`: the frames above it, then itself.
    if (!tooDeep && stack.length >= MAX_NESTING) {
      tooDeep = {
        rule: 'schema',
        severity: 'error',
        file,
        path,
        message: `${path} is nested more than ${MAX_NESTING} levels deep`,
      };
    }
    ancestors.add(node);
    stack.push({ node, path, next: 0, ...children });
  };

  enter(value, '');
  for (let frame = stack.at(-1); frame; frame = stack.at(-1)) {
    const entry = frame.entries[frame.next];
    // A sparse array's holes are one issue, in index order with the entries.
    if (
      frame.hole !== undefined &&
      (entry === undefined || Number(entry[0]) > frame.hole)
    ) {
      report(`${frame.path}/${frame.hole}`, true);
      frame.hole = undefined;
    }
    if (entry === undefined) {
      stack.pop();
      ancestors.delete(frame.node);
      continue;
    }
    frame.next += 1;
    const [key, descriptor] = entry;
    const childPath = `${frame.path}/${escapePointerToken(key)}`;
    // An accessor is not data and is not called.
    if (descriptor === undefined || !('value' in descriptor)) {
      report(childPath, true);
    } else {
      enter(descriptor.value, childPath);
    }
  }
  return tooDeep ? { issues, readable, tooDeep } : { issues, readable };
}
