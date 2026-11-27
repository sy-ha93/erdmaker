import { schemaFiles } from '../generated/schemas.js';
import type { SchemaName } from './ajv.js';

type SchemaObject = Readonly<Record<string, unknown>>;

/**
 * The schema of a value at some position of a file: the schema object found
 * there (before any `$ref` is followed) and the document it belongs to, which
 * a same-file `$ref` (`#/$defs/…`) is resolved against.
 */
export interface ValueSchema {
  readonly schema: SchemaObject;
  readonly document: SchemaObject;
}

/** A key of an object schema's `properties`. */
export interface PropertySchema {
  readonly schema: ValueSchema;
  readonly required: boolean;
  /** Set when the key has a `default`: at the key, else at a `$ref` target. */
  readonly default?: { readonly value: unknown };
}

/** What the schema says about the keys of an object value. */
export interface ObjectSchema {
  /** In the order of `properties`. */
  readonly properties: ReadonlyMap<string, PropertySchema>;
  /** The schema of every other key's value, when `additionalProperties` is a schema. */
  readonly additional?: ValueSchema;
}

const URN = 'urn:erdmaker:format:0.1:';

const isSchemaObject = (value: unknown): value is SchemaObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

let documents: Map<string, SchemaObject> | undefined;

/** The schema documents by `$id`. */
function documentsById(): Map<string, SchemaObject> {
  if (!documents) {
    documents = new Map();
    for (const document of Object.values(schemaFiles)) {
      if (isSchemaObject(document) && typeof document.$id === 'string') {
        documents.set(document.$id, document);
      }
    }
  }
  return documents;
}

/** The schema of a whole file of this kind. */
export function rootSchema(name: SchemaName): ValueSchema {
  const document = documentsById().get(URN + name);
  if (!document) throw new Error(`No schema ${URN + name}`);
  return { schema: document, document };
}

/** The schema a `$ref` names, in its document. Throws when it names nothing. */
function refTarget(ref: string, document: SchemaObject): ValueSchema {
  const hash = ref.indexOf('#');
  const base = hash === -1 ? ref : ref.slice(0, hash);
  const target = base === '' ? document : documentsById().get(base);
  if (!target) throw new Error(`$ref ${ref} names no schema`);
  let schema: unknown = target;
  const pointer = hash === -1 ? '' : ref.slice(hash + 1);
  if (pointer !== '') {
    for (const token of pointer.slice(1).split('/')) {
      const key = decodeURIComponent(token)
        .replaceAll('~1', '/')
        .replaceAll('~0', '~');
      schema = isSchemaObject(schema) ? schema[key] : undefined;
    }
  }
  if (!isSchemaObject(schema)) throw new Error(`$ref ${ref} names no schema`);
  return { schema, document: target };
}

/**
 * The schemas `at` stands for: itself, then each `$ref` target in turn.
 * Throws on a `$ref` that names nothing or a chain that loops (the schema
 * module is fixed, and a test resolves every `$ref` in it).
 */
function refChain(at: ValueSchema): ValueSchema[] {
  const chain = [at];
  const seen = new Set<SchemaObject>([at.schema]);
  for (let current = at; typeof current.schema.$ref === 'string';) {
    current = refTarget(current.schema.$ref, current.document);
    if (seen.has(current.schema)) {
      throw new Error(`$ref cycle at ${String(at.schema.$ref)}`);
    }
    seen.add(current.schema);
    chain.push(current);
  }
  return chain;
}

/** `at` with every `$ref` followed. */
export function resolveSchema(at: ValueSchema): ValueSchema {
  const chain = refChain(at);
  return chain[chain.length - 1]!;
}

const objectSchemas = new WeakMap<SchemaObject, ObjectSchema | null>();

/**
 * The keys of an object value whose schema is `at`: `$ref` followed, and for
 * `oneOf` the branch that has `properties` (spec FR-06). `allOf`, `if`,
 * `then` and `else` define no keys and are not read. Undefined when the
 * schema has neither `properties` nor an `additionalProperties` schema.
 * `properties` is read as a map of key names to schemas, so a key named
 * `default` is a key, not the keyword.
 */
export function objectSchema(at: ValueSchema): ObjectSchema | undefined {
  const cached = objectSchemas.get(at.schema);
  if (cached !== undefined) return cached ?? undefined;
  let target = resolveSchema(at);
  if (!isSchemaObject(target.schema.properties)) {
    const branches = target.schema.oneOf;
    const branch = Array.isArray(branches)
      ? branches
          .filter(isSchemaObject)
          .map((schema) => resolveSchema({ schema, document: target.document }))
          .find((resolved) => isSchemaObject(resolved.schema.properties))
      : undefined;
    if (branch) target = branch;
  }
  const { schema, document } = target;
  const properties = new Map<string, PropertySchema>();
  const required = new Set(
    Array.isArray(schema.required) ? (schema.required as unknown[]) : [],
  );
  if (isSchemaObject(schema.properties)) {
    for (const [key, value] of Object.entries(schema.properties)) {
      if (!isSchemaObject(value)) continue;
      const property = { schema: value, document };
      const found = refChain(property).find((step) =>
        Object.hasOwn(step.schema, 'default'),
      );
      properties.set(key, {
        schema: property,
        required: required.has(key),
        ...(found ? { default: { value: found.schema.default } } : {}),
      });
    }
  }
  const additional = isSchemaObject(schema.additionalProperties)
    ? { schema: schema.additionalProperties, document }
    : undefined;
  const result =
    properties.size > 0 || additional
      ? { properties, ...(additional ? { additional } : {}) }
      : undefined;
  objectSchemas.set(at.schema, result ?? null);
  return result;
}

/** The schema of each item of an array value whose schema is `at`. */
export function itemSchema(at: ValueSchema): ValueSchema | undefined {
  const { schema, document } = resolveSchema(at);
  return isSchemaObject(schema.items)
    ? { schema: schema.items, document }
    : undefined;
}

/**
 * The schema object at a JSON Pointer inside a whole file's schema, without
 * following `$ref`. For the few positions the writing rules name (spec FR-06).
 */
export function schemaAt(name: SchemaName, pointer: string): SchemaObject {
  const { schema } = refTarget(`#${pointer}`, rootSchema(name).document);
  return schema;
}
