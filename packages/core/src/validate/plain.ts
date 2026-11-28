/** An own data property of `value`, without calling getters or traps that throw. */
export function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The entries of `list` with their indexes, in index order (holes left out);
 * none when it is not an array or throws.
 */
export function indexed(list: unknown): [number, unknown][] {
  try {
    if (!Array.isArray(list)) return [];
    // Own keys, not every index, so a huge sparse array stays cheap.
    return Object.keys(list)
      .filter((key) => /^(?:0|[1-9]\d*)$/.test(key))
      .map((key): [number, unknown] => [Number(key), field(list, key)]);
  } catch {
    return [];
  }
}

/** The entries of `list` in index order; none when it is not an array or throws. */
export function listed(list: unknown): unknown[] {
  return indexed(list).map(([, entry]) => entry);
}

/** No array is longer; only a Proxy says so. */
const MAX_LIST_LENGTH = 2 ** 32 - 1;

/**
 * The entries of `value` when it is an array whose `length` reads as a
 * whole number from 0 to 2³² − 1 and whose every index below it is an own
 * data property holding a string; `undefined` otherwise. Reads `length`
 * first, then each index once, through its descriptor, and keeps the
 * descriptor's value (no `get` is made for an index, an accessor is never
 * called). Stops at the first index that is missing, an accessor or not a
 * string, so the work is linear in the entries up to there. Never throws.
 */
export function ownStrings(value: unknown): string[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const length: unknown = (value as readonly unknown[]).length;
    if (
      typeof length !== 'number' ||
      !Number.isInteger(length) ||
      length < 0 ||
      length > MAX_LIST_LENGTH
    ) {
      return undefined;
    }
    const entries: string[] = [];
    for (let i = 0; i < length; i += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      const entry: unknown =
        descriptor && 'value' in descriptor ? descriptor.value : undefined;
      if (typeof entry !== 'string') return undefined;
      entries.push(entry);
    }
    return entries;
  } catch {
    return undefined; // a revoked Proxy, or a trap that throws
  }
}
