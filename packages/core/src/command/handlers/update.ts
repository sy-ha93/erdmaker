/** Data being changed in place, field by field. */
export type Fields = Record<string, unknown>;

/** The `unset` names that point inside `physical`, and the key each names. */
const PHYSICAL_KEYS: ReadonlyMap<string, string> = new Map([
  ['physical.name', 'name'],
  ['physical.schema', 'schema'],
  ['physical.types', 'types'],
]);

const NO_DROPS: ReadonlyMap<string, string> = new Map();

/**
 * Applies a `*.update` to `fields` (spec FR-07): the `unset` names first,
 * then the `set` values, `set.physical` key by key and every other value
 * whole. A set key in `drops` removes the field it names (an attribute's
 * `domain` and `type`). Only a key the command removed empties `physical`
 * away; `physical: {}` it did not touch stays. `fields` and its `physical`
 * are this command's own copies; the names come from the command schema.
 */
export function applyUpdate(
  fields: Fields,
  set: object | undefined,
  unset: readonly string[] | undefined,
  drops: ReadonlyMap<string, string> = NO_DROPS,
): void {
  let emptied = false;
  for (const name of unset ?? []) {
    const inner = PHYSICAL_KEYS.get(name);
    if (inner === undefined) {
      delete fields[name];
      continue;
    }
    const physical = fields.physical as Fields | undefined;
    if (physical && Object.hasOwn(physical, inner)) {
      delete physical[inner];
      emptied = true;
    }
  }
  const values = (set ?? {}) as Fields;
  for (const key of Object.keys(values)) {
    const value = values[key];
    if (key === 'physical') {
      const physical = value as Fields;
      if (Object.keys(physical).length === 0) continue;
      fields.physical = { ...(fields.physical as Fields), ...physical };
      continue;
    }
    fields[key] = value;
    const dropped = drops.get(key);
    if (dropped !== undefined) delete fields[dropped];
  }
  const physical = fields.physical as Fields | undefined;
  if (emptied && physical && Object.keys(physical).length === 0) {
    delete fields.physical;
  }
}
