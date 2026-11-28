import { normalizePath } from '../fs/path.js';
import type { SchemaName } from '../schema/ajv.js';
import { compareCodeUnits } from '../compare.js';
import { checkItemData, itemText } from './serialize-item.js';
import type { Model, ReadonlyModel } from './types.js';

/** One file of a serialized model: its path (relative to the opened folder) and text. */
export interface SerializedFile {
  file: string;
  text: string;
}

const LISTS: readonly (readonly [keyof Model, SchemaName])[] = [
  ['dictionaries', 'dictionary'],
  ['entities', 'entity'],
  ['relationships', 'relationship'],
  ['subtypes', 'subtype'],
  ['subjectAreas', 'subject-area'],
  ['layouts', 'layout'],
];

/**
 * Every item of the model with its schema. Throws a `TypeError` when the
 * model is not shaped as one: not an object, a list that is not an array, an
 * item that is not an object, a `file` that is not a string or that names no
 * file (`''`, `.`, or anything else that normalizes to the opened folder).
 */
function modelFiles(
  model: ReadonlyModel,
): { file: string; data: unknown; schema: SchemaName }[] {
  if (typeof model !== 'object' || model === null) {
    throw new TypeError('Cannot write a model that is not an object');
  }
  const out: { file: string; data: unknown; schema: SchemaName }[] = [];
  const add = (item: unknown, where: string, schema: SchemaName) => {
    if (typeof item !== 'object' || item === null) {
      throw new TypeError(`Cannot write ${where}: not an item`);
    }
    const { file, data } = item as { file?: unknown; data?: unknown };
    if (typeof file !== 'string') {
      throw new TypeError(`Cannot write ${where}: its file is not a path`);
    }
    if (normalizePath(file) === '') {
      throw new TypeError(
        `Cannot write ${where}: its file ${JSON.stringify(file)} names no file`,
      );
    }
    out.push({ file, data, schema });
  };
  if (model.manifest !== undefined) add(model.manifest, 'manifest', 'model');
  for (const [key, schema] of LISTS) {
    const list: unknown = model[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      throw new TypeError(`Cannot write ${key}: not a list`);
    }
    for (let index = 0; index < list.length; index += 1) {
      add(list[index], `${key}[${index}]`, schema);
    }
  }
  return out;
}

/**
 * The files of a model as `{ file, text }` in code unit order of `file`,
 * without touching any file (spec FR-06). Each item is written at its own
 * `file`; a layout as JSON, every other item as YAML. The same model always
 * gives the same text. Does not change the model.
 *
 * Throws a `TypeError`, writing nothing, for every condition it detects:
 * - an item's data is not JSON data (the values `validateModel` reports as
 *   `must be a JSON value`): `Cannot write <file>: <path> must be a JSON value`;
 * - an item's data nests collections more than `MAX_NESTING` levels deep,
 *   which reading would refuse (`validateModel` reports it too):
 *   `Cannot write <file>: <path> is nested more than 256 levels deep`;
 * - an item's shared objects would be copied, one copy per place, into more
 *   than `MAX_COPIED_VALUES` values (`validateModel` reports it too):
 *   `Cannot write <file>: / has shared objects whose copies would hold more
 *   than 100000 values`;
 * - the model is not shaped as one: it is not an object, a list is not an
 *   array, an item is not an object, an item's `file` is not a string or
 *   normalizes to the opened folder itself (`''`, `.`, `./`, `a/..`, `/`);
 * - two items' `file` normalize to the same path;
 * - building an item's text throws a `RangeError`: the text would be
 *   longer than the longest JavaScript string, or (with a small stack)
 *   building it overflows the stack: `Cannot write <file>: it is too large
 *   or too deeply nested to write`. Nothing checks for this beforehand;
 *   `validateModel` does not report it.
 * The `TypeError` is the only error it throws itself; an exception thrown by
 * a getter of the model object (not of its data) passes through unchanged.
 * Any other data is written as it is, valid against the schemas or not.
 */
export function serializeModel(model: ReadonlyModel): SerializedFile[] {
  const items = modelFiles(model);
  const paths = new Map<string, string>();
  for (const { file } of items) {
    const path = normalizePath(file);
    const other = paths.get(path);
    if (other !== undefined) {
      throw new TypeError(`Cannot write ${file}: ${other} is the same file`);
    }
    paths.set(path, file);
  }
  // Every item is checked before any text is built.
  for (const { file, data } of items) checkItemData(file, data);
  return items
    .map(({ file, data, schema }) => ({
      file,
      text: itemText(file, data, schema),
    }))
    .sort((a, b) => compareCodeUnits(a.file, b.file));
}
