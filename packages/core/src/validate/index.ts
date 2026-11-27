import type { Issue, Model, ModelItem } from '../model/types.js';
import type { SchemaName } from '../schema/ajv.js';
import { type FilePositions, finishIssues } from './issues.js';
import { itemIssues } from './schema.js';

/** An own data property of `value`, without calling getters or traps that throw. */
function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/** The entries of `list` in index order; none when it is not an array or throws. */
function listed(list: unknown): unknown[] {
  try {
    if (!Array.isArray(list)) return [];
    // Own keys, not every index, so a huge sparse array stays cheap.
    return Object.keys(list)
      .filter((key) => /^(?:0|[1-9]\d*)$/.test(key))
      .map((key) => field(list, key));
  } catch {
    return [];
  }
}

/**
 * Every item of the model with the schema of its file, in reading order.
 * Reads the model as plain data without calling getters: a list that is
 * missing or not an array counts as empty, an item without a `file` name is
 * skipped (there is nowhere to report it), and a `data` that is missing or
 * not a data property is `undefined`, so it is reported at its file.
 */
export function modelItems(model: Model): [ModelItem<unknown>, SchemaName][] {
  const items: [ModelItem<unknown>, SchemaName][] = [];
  const add = (item: unknown, schema: SchemaName) => {
    const file = field(item, 'file');
    if (typeof file === 'string') {
      items.push([{ file, data: field(item, 'data') }, schema]);
    }
  };
  const manifest = field(model, 'manifest');
  if (manifest !== undefined) add(manifest, 'model');
  const lists: [keyof Model, SchemaName][] = [
    ['dictionaries', 'dictionary'],
    ['entities', 'entity'],
    ['relationships', 'relationship'],
    ['subtypes', 'subtype'],
    ['subjectAreas', 'subject-area'],
    ['layouts', 'layout'],
  ];
  for (const [key, schema] of lists) {
    for (const item of listed(field(model, key))) add(item, schema);
  }
  return items;
}

/**
 * Checks a model without touching files: every item against its schema and
 * for values that are not JSON data. With `positions` (from `loadModel`) the
 * issues get lines and columns; without, only paths. Sorted by file, then
 * position. Does not change the model and never throws, whatever the items'
 * `data` holds or however the model itself is malformed (see `modelItems`).
 */
export function validateModel(
  model: Model,
  positions?: FilePositions,
): Issue[] {
  const issues: Issue[] = [];
  for (const [{ file, data }, schema] of modelItems(model)) {
    for (const issue of itemIssues(file, schema, data)) issues.push(issue);
  }
  return finishIssues(issues, positions);
}
