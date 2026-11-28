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
import type { SchemaName } from '../schema/ajv.js';
import { rootSchema } from '../schema/resolve.js';
import { checkJsonValue } from '../validate/json-value.js';
import { type Canon, canonical, isCanonContainer } from './canonical.js';
import { layoutJson } from './layout-json.js';

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

/**
 * Throws `Cannot write <file>: <message>` as a `TypeError` for the first
 * thing `checkJsonValue` finds in `data`: a value that is not JSON data, then
 * nesting past `MAX_NESTING`, then shared objects copied too often. The same
 * checks and the same first path as `validateModel` reports. Never calls a
 * getter of `data`.
 */
export function checkItemData(file: string, data: unknown): void {
  const { issues, tooDeep, tooLarge } = checkJsonValue(file, data);
  const issue = issues[0] ?? tooDeep ?? tooLarge;
  if (issue) throw new TypeError(`Cannot write ${file}: ${issue.message}`);
}

/**
 * The text of one file whose data passed `checkItemData`: a layout as JSON,
 * every other item as YAML. A `RangeError` from building the text (longer
 * than the longest string, or past the stack) becomes `Cannot write <file>:
 * it is too large or too deeply nested to write` as a `TypeError` with the
 * original as its `cause`; any other error, and every error from putting
 * the data in writing order, passes through unchanged.
 */
export function itemText(
  file: string,
  data: unknown,
  schema: SchemaName,
): string {
  const written = canonical(file, data, rootSchema(schema));
  try {
    return schema === 'layout' ? layoutJson(written) : yamlText(written);
  } catch (error) {
    // Longer than the longest string, or past the stack; the checks do not
    // predict either.
    if (error instanceof RangeError) {
      throw new TypeError(
        `Cannot write ${file}: it is too large or too deeply nested to write`,
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * The text `serializeModel` writes for one item at `file` with the data
 * `data` and the schema `schema`: `checkItemData`, then `itemText`, with
 * their errors.
 */
export function serializeItem(
  file: string,
  data: unknown,
  schema: SchemaName,
): string {
  checkItemData(file, data);
  return itemText(file, data, schema);
}
