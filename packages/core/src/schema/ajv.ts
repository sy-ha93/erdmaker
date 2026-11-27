import {
  _,
  Ajv2020,
  type AnySchemaObject,
  type CodeKeywordDefinition,
  str,
  type ValidateFunction,
} from 'ajv/dist/2020.js';
import { schemaFiles } from '../generated/schemas.js';

/** The schema of each kind of model file, by its `$id` without the common prefix. */
export type SchemaName =
  | 'model'
  | 'entity'
  | 'relationship'
  | 'subtype'
  | 'subject-area'
  | 'layout'
  | 'dictionary';

const URN = 'urn:erdmaker:format:0.1:';

/** Stands in for `uniqueItems` where Ajv would compare every pair of items. */
const UNIQUE_ITEMS = 'erdmakerUniqueItems';

/** Keywords whose value is one schema, a list of schemas, or a map of names to schemas. */
const ONE_SCHEMA = [
  'items',
  'additionalProperties',
  'propertyNames',
  'contains',
  'not',
  'if',
  'then',
  'else',
  'unevaluatedItems',
  'unevaluatedProperties',
];
const SCHEMA_LISTS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];
const SCHEMA_MAPS = [
  '$defs',
  'properties',
  'patternProperties',
  'dependentSchemas',
];

type SchemaObject = Record<string, unknown>;

const isObject = (value: unknown): value is SchemaObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Whether Ajv checks `uniqueItems` under `items` with a hash of the items:
 * only when `items` declares scalar types. Otherwise it compares every pair,
 * which takes quadratic time (a subject area's `entities`, a key's
 * `attributes`). Mirrors `canOptimize` in Ajv's `uniqueItems` keyword.
 */
function hashesItems(items: unknown): boolean {
  if (!isObject(items)) return false;
  const type = items.type;
  const types = type === undefined ? [] : Array.isArray(type) ? type : [type];
  return (
    types.length > 0 &&
    !types.some((name) => name === 'object' || name === 'array')
  );
}

const schemaRoots = new Map<string, SchemaObject>();
for (const schema of Object.values(schemaFiles)) {
  if (isObject(schema) && typeof schema.$id === 'string') {
    schemaRoots.set(schema.$id, schema);
  }
}

/** The schema a `$ref` names, and the root its own local references resolve against. */
function resolveRef(
  ref: string,
  root: SchemaObject,
): { schema: unknown; root: SchemaObject; key: string } {
  const hash = ref.indexOf('#');
  const base = hash === -1 ? ref : ref.slice(0, hash);
  const fragment = hash === -1 ? '' : ref.slice(hash + 1);
  const target = base === '' ? root : schemaRoots.get(base);
  if (!target) throw new Error(`Unknown schema in $ref ${ref}`);
  let schema: unknown = target;
  for (const token of fragment.split('/').slice(1)) {
    const name = token.replace(/~1/g, '/').replace(/~0/g, '~');
    schema = isObject(schema) ? schema[name] : undefined;
  }
  if (schema === undefined) throw new Error(`Unresolved $ref ${ref}`);
  return { schema, root: target, key: `${String(target.$id)}#${fragment}` };
}

/**
 * A copy of a schema for Ajv that reports the same errors in linear time.
 * Ajv joins the errors of a referenced schema to the earlier ones by copying
 * them all, once per failing reference, so every `$ref` is replaced by a copy
 * of its target. A `uniqueItems` that Ajv would check pair by pair becomes
 * `UNIQUE_ITEMS`. Only schema positions are looked at, so a property named
 * `uniqueItems` or `$ref` stays a property. Throws on a recursive `$ref`,
 * which the format's schemas do not have.
 */
function prepareSchema(
  schema: unknown,
  root: SchemaObject,
  active: Set<string> = new Set(),
): unknown {
  if (!isObject(schema)) return schema;
  const copy: SchemaObject = {};
  for (const [keyword, value] of Object.entries(schema)) {
    if (keyword === '$ref' && typeof value === 'string') continue;
    if (ONE_SCHEMA.includes(keyword)) {
      copy[keyword] = prepareSchema(value, root, active);
    } else if (SCHEMA_LISTS.includes(keyword) && Array.isArray(value)) {
      copy[keyword] = value.map((sub) => prepareSchema(sub, root, active));
    } else if (SCHEMA_MAPS.includes(keyword) && isObject(value)) {
      copy[keyword] = Object.fromEntries(
        Object.entries(value).map(([name, sub]) => [
          name,
          prepareSchema(sub, root, active),
        ]),
      );
    } else if (
      keyword === 'uniqueItems' &&
      value === true &&
      // Decided on `items` as written: with its `$ref` replaced, Ajv would hash.
      !hashesItems(schema.items)
    ) {
      copy[UNIQUE_ITEMS] = true;
    } else {
      copy[keyword] = value;
    }
  }
  if (typeof schema.$ref !== 'string') return copy;

  const target = resolveRef(schema.$ref, root);
  if (active.has(target.key)) {
    throw new Error(`Recursive $ref ${schema.$ref}`);
  }
  active.add(target.key);
  const inlined = prepareSchema(target.schema, target.root, active);
  active.delete(target.key);
  if (isObject(inlined)) {
    delete inlined.$id;
    delete inlined.$schema;
  }
  if (Object.keys(copy).length === 0) return inlined;
  const allOf = Array.isArray(copy.allOf) ? copy.allOf : [];
  return { ...copy, allOf: [...allOf, inlined] };
}

const literal = Symbol('literal');
type Token = unknown | { [literal]: string };

/**
 * One string per JSON value such that two values get the same string exactly
 * when they are equal as Ajv compares items: object keys in any order, `0`
 * equal to `-0`. Walks with an explicit stack, so any depth fits.
 */
export function canonicalJson(value: unknown): string {
  let out = '';
  const pending: Token[] = [value];
  const text = (part: string): Token => ({ [literal]: part });
  while (pending.length > 0) {
    const token = pending.pop();
    if (typeof token === 'object' && token !== null && literal in token) {
      out += token[literal];
    } else if (Array.isArray(token)) {
      const parts: Token[] = [text('[')];
      for (let i = 0; i < token.length; i += 1) {
        if (i > 0) parts.push(text(','));
        parts.push(token[i]);
      }
      parts.push(text(']'));
      for (let i = parts.length - 1; i >= 0; i -= 1) pending.push(parts[i]);
    } else if (typeof token === 'object' && token !== null) {
      const keys = Object.keys(token).sort((a, b) =>
        a < b ? -1 : a > b ? 1 : 0,
      );
      const parts: Token[] = [text('{')];
      keys.forEach((key, i) =>
        parts.push(
          text(`${i ? ',' : ''}${JSON.stringify(key)}:`),
          (token as Record<string, unknown>)[key],
        ),
      );
      parts.push(text('}'));
      for (let i = parts.length - 1; i >= 0; i -= 1) pending.push(parts[i]);
    } else if (typeof token === 'string') {
      out += JSON.stringify(token);
    } else {
      // `String(-0)` is "0", as `-0 === 0`.
      out += `${typeof token}:${String(token)}`;
    }
  }
  return out;
}

/**
 * The pair Ajv reports for an array with equal items, in one pass: the last
 * item equal to an earlier one (`i`) and the nearest earlier item equal to it
 * (`j`), as its pairwise check finds them.
 */
export function duplicateItems(
  items: readonly unknown[],
): { i: number; j: number } | undefined {
  const last = new Map<string, number>();
  let found: { i: number; j: number } | undefined;
  // By index, not `forEach`, so the holes of a sparse array count as Ajv counts them.
  for (let i = 0; i < items.length; i += 1) {
    const key = canonicalJson(items[i]);
    const j = last.get(key);
    if (j !== undefined) found = { i, j };
    last.set(key, i);
  }
  return found;
}

/**
 * `UNIQUE_ITEMS`, worded and keyed like Ajv's own `uniqueItems` error. Made
 * as generated code, like Ajv's keywords, so each error is appended to the
 * list instead of the list being copied.
 */
const uniqueItemsKeyword: CodeKeywordDefinition = {
  keyword: UNIQUE_ITEMS,
  type: 'array',
  schemaType: 'boolean',
  error: {
    message: ({ params }) =>
      str`must NOT have duplicate items (items ## ${params.j} and ${params.i} are identical)`,
    params: ({ params }) => _`{i: ${params.i}, j: ${params.j}}`,
  },
  code(cxt) {
    const { gen, data } = cxt;
    const find = gen.scopeValue('func', { ref: duplicateItems });
    const found = gen.const('found', _`${find}(${data})`);
    cxt.setParams({ i: _`${found}.i`, j: _`${found}.j` });
    cxt.fail(_`${found} !== undefined`);
  },
};

let ajv: Ajv2020 | undefined;

/** The one Ajv instance, set up as the old tool's and holding the 8 schemas. Made on first use. */
export function schemaAjv(): Ajv2020 {
  if (!ajv) {
    const instance = new Ajv2020({
      allErrors: true,
      strict: false,
      strictSchema: true,
    });
    instance.addKeyword(uniqueItemsKeyword);
    for (const schema of schemaRoots.values()) {
      instance.addSchema(prepareSchema(schema, schema) as AnySchemaObject);
    }
    ajv = instance;
  }
  return ajv;
}

/** The compiled check for one kind of file. Compiled on first use. */
export function schemaValidator(name: SchemaName): ValidateFunction {
  const validate = schemaAjv().getSchema(URN + name);
  if (!validate) throw new Error(`No schema ${URN + name}`);
  return validate;
}
