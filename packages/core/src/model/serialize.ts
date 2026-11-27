import {
  Document,
  isMap,
  isScalar,
  isSeq,
  Pair,
  Scalar,
  type Node as YamlNode,
  YAMLMap,
  YAMLSeq,
} from 'yaml';
import { normalizePath } from '../fs/path.js';
import type { SchemaName } from '../schema/ajv.js';
import { rootSchema } from '../schema/resolve.js';
import { checkJsonValue } from '../validate/json-value.js';
import { compareCodeUnits } from '../compare.js';
import { type Canon, canonical, isCanonContainer } from './canonical.js';
import { layoutJson } from './layout-json.js';
import type { Model } from './types.js';

/** One file of a serialized model: its path (relative to the opened folder) and text. */
export interface SerializedFile {
  file: string;
  text: string;
}

/**
 * The `yaml` options spec chapter 7 names: no folding of long lines, YAML 1.1
 * keywords (`NO`, `y`, `1:30`) quoted, no anchors for shared objects. And
 * double-quoted text on one line however long: `yaml` 2.9.1 breaks a
 * double-quoted text of 40 characters or more at its newlines and then
 * escapes a space after a newline twice (`"…\n \n…"` reads back with a
 * backslash). The same object goes to the document and to `toString`, as
 * `stringify` does.
 */
const YAML_OPTIONS = {
  version: '1.2',
  schema: 'core',
  lineWidth: 0,
  compat: 'yaml-1.1',
  aliasDuplicateObjects: false,
  doubleQuotedMinMultiLineLength: Infinity,
} as const;

/**
 * Whether the text has a line end and nothing but line ends, spaces and
 * tabs. As a block scalar no line of it sets the indentation, so a reader
 * drops its spaces (`yaml` writes `" \n\n"` as `|+` and reads it back as
 * `"\n\n"`); it is written double-quoted. One scan, so linear in the text (a
 * regular expression with a repetition on each side of `\n` backtracks).
 */
function isBlankLines(text: string): boolean {
  let lineEnd = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\n') lineEnd = true;
    else if (char !== ' ' && char !== '\t') return false;
  }
  return lineEnd;
}

/**
 * The YAML 1.1 value key `=` (`tag:yaml.org,2002:value`). `compat:
 * 'yaml-1.1'` quotes the other YAML 1.1 types (the merge key `<<` included)
 * but not this one, and PyYAML's `safe_load` refuses a file with a plain `=`
 * as a value. Written double-quoted, as a value and as a key.
 */
const YAML11_VALUE = '=';

/** The YAML node of a key. */
function keyNode(doc: Document, key: string): YamlNode {
  const node = doc.createNode(key);
  if (key === YAML11_VALUE) node.type = Scalar.QUOTE_DOUBLE;
  return node;
}

/** The YAML node of a written value (recursion bounded, as `canonical` is). */
function yamlNode(doc: Document, value: Canon): YamlNode {
  if (!isCanonContainer(value)) {
    const node = doc.createNode(value);
    if (
      typeof value === 'string' &&
      (value === YAML11_VALUE || isBlankLines(value))
    ) {
      node.type = Scalar.QUOTE_DOUBLE;
    }
    return node;
  }
  if (value.kind === 'list') {
    const seq = new YAMLSeq(doc.schema);
    for (const item of value.items) seq.items.push(yamlNode(doc, item));
    return seq;
  }
  const map = new YAMLMap(doc.schema);
  for (const [key, item] of value.entries) {
    map.items.push(new Pair(keyNode(doc, key), yamlNode(doc, item)));
  }
  return map;
}

/** The value written last in the file, when it is a scalar. */
function lastScalar(node: unknown): Scalar | undefined {
  let current = node;
  for (;;) {
    if (isMap(current) && current.items.length > 0) {
      current = current.items[current.items.length - 1]!.value;
    } else if (isSeq(current) && current.items.length > 0) {
      current = current.items[current.items.length - 1];
    } else {
      return isScalar(current) ? current : undefined;
    }
  }
}

/**
 * A YAML file's text (spec FR-06): block style, two-space indents, LF, one
 * line end at the end. A multi-line text ending in two or more newlines
 * becomes a `|+` block scalar, which would end the file in as many line
 * ends; as the file's last value it is written as an escaped double-quoted
 * scalar instead.
 */
function yamlText(data: Canon): string {
  const doc = new Document(null, YAML_OPTIONS);
  doc.contents = yamlNode(doc, data);
  const last = lastScalar(doc.contents);
  if (last && typeof last.value === 'string' && last.value.endsWith('\n\n')) {
    last.type = Scalar.QUOTE_DOUBLE;
  }
  return doc.toString(YAML_OPTIONS);
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
  model: Model,
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
export function serializeModel(model: Model): SerializedFile[] {
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
  for (const { file, data } of items) {
    // The same checks and the same first path as `validateModel` reports.
    const { issues, tooDeep, tooLarge } = checkJsonValue(file, data);
    const issue = issues[0] ?? tooDeep ?? tooLarge;
    if (issue) throw new TypeError(`Cannot write ${file}: ${issue.message}`);
  }
  return items
    .map(({ file, data, schema }) => {
      const written = canonical(file, data, rootSchema(schema));
      try {
        return {
          file,
          text: schema === 'layout' ? layoutJson(written) : yamlText(written),
        };
      } catch (error) {
        // Longer than the longest string, or past the stack; the checks
        // above do not predict either.
        if (error instanceof RangeError) {
          throw new TypeError(
            `Cannot write ${file}: it is too large or too deeply nested to write`,
            { cause: error },
          );
        }
        throw error;
      }
    })
    .sort((a, b) => compareCodeUnits(a.file, b.file));
}
