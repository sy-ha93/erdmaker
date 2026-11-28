import type { Issue } from '../model/types.js';
import { escapePointerToken } from '../parse/pointer.js';
import { MAX_NESTING } from '../parse/yaml.js';

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Whether a number is JSON data a file can hold: finite, and an
 * integer-valued number exact, however it was written (`1e300` and `2 ** 53`
 * are rejected). The one number rule of the format; the command copy uses
 * it too (F03 FR-03).
 */
export function isJsonNumber(value: number): boolean {
  return Number.isInteger(value)
    ? Number.isSafeInteger(value)
    : Number.isFinite(value);
}

function isJsonScalar(value: unknown): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return true;
    case 'number':
      return isJsonNumber(value);
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
  /** Issues found before this container. */
  issuesBefore: number;
  /** Collection levels in it, itself included, so far. */
  height: number;
  /** Values written for it, itself included, so far. */
  size: number;
  /** A place reached again whose whole copy was counted when it was entered. */
  paid: boolean;
}

/** A container walked to its end: its levels, its values as written, and whether it held no issue. */
interface Walked {
  height: number;
  size: number;
  clean: boolean;
}

/**
 * The most values the copies of shared objects may add to one file's data.
 * `serializeModel` writes a shared object at each place, so data in memory
 * whose levels each hold the level below twice would be written out in
 * exponential size; data read from a file shares nothing.
 */
export const MAX_COPIED_VALUES = 100_000;

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
  /**
   * Shared objects whose copies would add more than `MAX_COPIED_VALUES`
   * values when the data is written out: `/ has shared objects whose copies
   * would hold more than 100000 values`, at `""`. Copies past the limit are
   * not looked at. Not in `issues`.
   */
  tooLarge?: Issue;
}

/**
 * Finds every value that is not JSON data: anything other than null, a
 * boolean, a string, a finite number (integers within the safe range), an
 * array or a plain object. Shared references are fine (see `tooLarge` of
 * `checkJsonValue` for a limit); a cycle is reported where it closes. The
 * holes of a sparse array are one issue, at the first hole. Never throws,
 * whatever `value` is, however deeply it nests.
 */
export function jsonValueIssues(file: string, value: unknown): Issue[] {
  return checkJsonValue(file, value).issues;
}

/**
 * `jsonValueIssues`, whether the data is safe to give to code that reads it
 * as data, whether it nests deeper than a file may hold, and whether its
 * shared objects would be copied too often to write it out. One walk with an
 * explicit stack, without recursion. A shared object found free of issues
 * is not walked again where it fits below the nesting limit; one with
 * issues is, so they are reported at each place, until the copies reach
 * `MAX_COPIED_VALUES`. Each copied value is counted once: a place reached
 * again counts its whole copy, and the places inside that copy are not
 * counted again while it is walked. So the time is linear in the distinct
 * objects, plus at most that many values.
 */
export function checkJsonValue(file: string, value: unknown): JsonValueCheck {
  const issues: Issue[] = [];
  let readable = true;
  let tooDeep: Issue | undefined;
  let tooLarge: Issue | undefined;
  // Values the places reached again add, as written: each copied value once.
  let copied = 0;
  // Whether a copy already counted whole is being walked: a place reached
  // again inside it is part of that copy and is not counted again.
  let inPaidCopy = false;
  const walked = new Map<object, Walked>();
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

  /** Adds a finished child's levels and values to the container holding it. */
  const addChild = (height: number, size: number) => {
    const parent = stack.at(-1);
    if (!parent) return;
    parent.height = Math.max(parent.height, height + 1);
    parent.size += size;
  };

  /** Reports `node` or, for a container, starts walking it. */
  const enter = (node: unknown, path: string): void => {
    if (isJsonScalar(node)) {
      addChild(0, 1);
      return;
    }
    if (typeof node !== 'object' || node === null) {
      report(path);
      addChild(0, 1);
      return;
    }
    if (ancestors.has(node)) {
      report(path, true);
      addChild(0, 1);
      return;
    }
    const before = walked.get(node);
    if (before) {
      if (!inPaidCopy) copied += before.size;
      if (copied > MAX_COPIED_VALUES) {
        tooLarge ??= {
          rule: 'schema',
          severity: 'error',
          file,
          path: '',
          message: `/ has shared objects whose copies would hold more than ${MAX_COPIED_VALUES} values`,
        };
        addChild(before.height, before.size);
        return;
      }
      // Free of issues and, at this level, of collections past the limit (or one was found already).
      const fits =
        tooDeep !== undefined || stack.length + before.height <= MAX_NESTING;
      if (before.clean && fits) {
        addChild(before.height, before.size);
        return;
      }
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
        addChild(0, 1);
        return;
      }
    } catch {
      report(path, true);
      addChild(0, 1);
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
    const paid = before !== undefined && !inPaidCopy;
    if (paid) inPaidCopy = true;
    stack.push({
      node,
      path,
      next: 0,
      ...children,
      issuesBefore: issues.length,
      height: 1,
      size: 1,
      paid,
    });
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
      if (frame.paid) inPaidCopy = false;
      walked.set(frame.node, {
        height: frame.height,
        size: frame.size,
        clean: issues.length === frame.issuesBefore,
      });
      addChild(frame.height, frame.size);
      continue;
    }
    frame.next += 1;
    const [key, descriptor] = entry;
    const childPath = `${frame.path}/${escapePointerToken(key)}`;
    // An accessor is not data and is not called.
    if (descriptor === undefined || !('value' in descriptor)) {
      report(childPath, true);
      addChild(0, 1);
    } else {
      enter(descriptor.value, childPath);
    }
  }
  return {
    issues,
    readable,
    ...(tooDeep ? { tooDeep } : {}),
    ...(tooLarge ? { tooLarge } : {}),
  };
}
