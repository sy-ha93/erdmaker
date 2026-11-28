import { escapePointerToken } from '../parse/pointer.js';
import { isJsonNumber } from '../validate/json-value.js';

/** The deepest a container may be; the command object is level 1 (spec FR-03). */
const MAX_DEPTH = 32;
/** The most keys and array items a command may hold. */
const MAX_VALUES = 100_000;
/** The most code units of keys and string values a command may hold. */
const MAX_TEXT = 1_000_000;

export type Copied =
  { ok: true; value: Record<string, unknown> } | { ok: false; message: string };

type Kind = 'scalar' | 'array' | 'object' | 'bad';

/** One container being copied: its next entry to visit is `next`. */
interface Frame {
  source: object;
  target: Record<string, unknown> | unknown[];
  /** Absent for the command itself. */
  parent?: Frame;
  /** Its key or index in the parent. */
  token: string;
  depth: number;
  /** An object's keys; absent for an array. */
  keys?: readonly string[];
  length: number;
  next: number;
}

/**
 * What a value is, as FR-03 accepts it. A trap or a revoked proxy that throws
 * makes it `bad`.
 */
function kindOf(value: unknown): Kind {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return 'scalar';
    case 'number':
      // F02's rule: finite, and an integer within the safe range.
      return isJsonNumber(value) ? 'scalar' : 'bad';
    case 'object': {
      if (value === null) return 'scalar';
      try {
        if (Array.isArray(value)) {
          // A subclass instance is a class instance (as in F02).
          return Object.getPrototypeOf(value) === Array.prototype
            ? 'array'
            : 'bad';
        }
        const proto: unknown = Object.getPrototypeOf(value);
        return proto === Object.prototype || proto === null ? 'object' : 'bad';
      } catch {
        return 'bad';
      }
    }
    default:
      return 'bad';
  }
}

/** The JSON Pointer of `token` in `frame` (of `frame` itself without one), `/` for the command. */
function pointer(frame: Frame, token?: string): string {
  const tokens = token === undefined ? [] : [token];
  for (let at: Frame | undefined = frame; at?.parent; at = at.parent) {
    tokens.push(at.token);
  }
  if (tokens.length === 0) return '/';
  let path = '';
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    path += `/${escapePointerToken(tokens[i]!)}`;
  }
  return path;
}

/**
 * A frame for `source` (of kind `kind`), with its keys or its length read
 * once; `undefined` when reading them throws or the length is not one.
 */
function open(
  source: object,
  kind: 'array' | 'object',
  parent: Frame | undefined,
  token: string,
): Frame | undefined {
  const depth = parent ? parent.depth + 1 : 1;
  try {
    if (kind === 'object') {
      const keys = Object.keys(source);
      return {
        source,
        target: {},
        parent,
        token,
        depth,
        keys,
        length: keys.length,
        next: 0,
      };
    }
    const length: unknown = (source as unknown[]).length;
    if (
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      length < 0
    ) {
      return undefined;
    }
    return { source, target: [], parent, token, depth, length, next: 0 };
  } catch {
    return undefined;
  }
}

/** Sets `key` as an own data property, `__proto__` included. */
function put(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

const fail = (message: string): Copied => ({ ok: false, message });
const notJson = (path: string): Copied => fail(`${path} must be a JSON value`);

/**
 * Steps 1 and 2 of spec FR-03: `input` walked once and copied as plain data,
 * or the first failure's message (before the one-line treatment). Each
 * object's own enumerable string keys are read once each, in order, and an
 * array's `length` once and then its indexes through their descriptors.
 * Depth first, with an explicit stack; the walk stops at the first value
 * past a limit or not accepted, and within one visit reports depth, then
 * values, then text, then the value itself. Never throws.
 */
export function copyCommand(input: unknown): Copied {
  if (typeof input !== 'object' || input === null) {
    return fail('command must be an object');
  }
  try {
    if (Array.isArray(input)) return fail('command must be an object');
  } catch {
    return notJson('/');
  }
  const rootKind = kindOf(input);
  if (rootKind !== 'object') return notJson('/');
  const root = open(input, 'object', undefined, '');
  if (!root) return notJson('/');

  let values = 0;
  let text = 0;
  const stack: Frame[] = [root];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    if (frame.next >= frame.length) {
      stack.pop();
      continue;
    }
    const index = frame.next;
    frame.next += 1;
    values += 1;

    let token: string;
    let value: unknown;
    let kind: Kind;
    if (frame.keys) {
      token = frame.keys[index]!;
      text += token.length;
      try {
        value = (frame.source as Record<string, unknown>)[token];
        kind = value === undefined ? 'scalar' : kindOf(value);
      } catch {
        kind = 'bad';
      }
    } else {
      token = String(index);
      try {
        const descriptor = Object.getOwnPropertyDescriptor(frame.source, token);
        // A hole, an inherited value or an accessor is not an item.
        if (descriptor && Object.hasOwn(descriptor, 'value')) {
          value = descriptor.value;
          kind = value === undefined ? 'bad' : kindOf(value);
        } else {
          kind = 'bad';
        }
      } catch {
        kind = 'bad';
      }
    }

    // Counted before deciding to leave the value out or refuse it.
    const container = kind === 'array' || kind === 'object';
    if (container && frame.depth + 1 > MAX_DEPTH) {
      return fail(`command is nested more than ${MAX_DEPTH} levels deep`);
    }
    if (values > MAX_VALUES) {
      return fail(`command has more than ${MAX_VALUES} values`);
    }
    if (kind !== 'bad' && typeof value === 'string') text += value.length;
    if (text > MAX_TEXT) {
      return fail(`command has more than ${MAX_TEXT} characters of text`);
    }
    if (kind === 'bad') return notJson(pointer(frame, token));
    // An object's undefined property is left out, as `JSON.stringify` does.
    if (value === undefined) continue;

    let copy: unknown = value;
    if (kind === 'array' || kind === 'object') {
      const child = open(value as object, kind, frame, token);
      if (!child) return notJson(pointer(frame, token));
      copy = child.target;
      stack.push(child);
    }
    if (Array.isArray(frame.target)) frame.target.push(copy);
    else put(frame.target, token, copy);
  }
  return { ok: true, value: root.target as Record<string, unknown> };
}
