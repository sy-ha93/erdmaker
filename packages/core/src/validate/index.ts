import type { Issue, Model, ModelItem } from '../model/types.js';
import type { SchemaName } from '../schema/ajv.js';
import { type FilePositions, finishIssues } from './issues.js';
import { itemIssues } from './schema.js';

/** Every item of the model with the schema of its file, in reading order. */
export function modelItems(model: Model): [ModelItem<unknown>, SchemaName][] {
  const items: [ModelItem<unknown>, SchemaName][] = [];
  if (model.manifest) items.push([model.manifest, 'model']);
  const lists: [readonly ModelItem<unknown>[], SchemaName][] = [
    [model.dictionaries, 'dictionary'],
    [model.entities, 'entity'],
    [model.relationships, 'relationship'],
    [model.subtypes, 'subtype'],
    [model.subjectAreas, 'subject-area'],
    [model.layouts, 'layout'],
  ];
  for (const [list, schema] of lists) {
    for (const item of list) items.push([item, schema]);
  }
  return items;
}

/**
 * Checks a model without touching files: every item against its schema and
 * for values that are not JSON data. With `positions` (from `loadModel`) the
 * issues get lines and columns; without, only paths. Sorted by file, then
 * position. Does not change the model and never throws, whatever the items'
 * `data` holds.
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
