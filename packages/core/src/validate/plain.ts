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
