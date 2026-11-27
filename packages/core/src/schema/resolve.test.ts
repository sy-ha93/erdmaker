import { describe, expect, test } from 'vitest';
import { schemaFiles } from '../generated/schemas.js';
import {
  itemSchema,
  objectSchema,
  type ObjectSchema,
  resolveSchema,
  rootSchema,
  schemaAt,
  type ValueSchema,
} from './resolve.js';

type SchemaObject = Record<string, unknown>;

const COMMON = schemaFiles['common.schema.json'] as SchemaObject;
const commonDef = (name: string) =>
  (COMMON.$defs as Record<string, unknown>)[name];

function shape(at: ValueSchema | undefined): ObjectSchema {
  if (!at) throw new Error('no schema');
  const found = objectSchema(at);
  if (!found) throw new Error('no object schema');
  return found;
}

function property(at: ValueSchema | undefined, key: string) {
  const found = shape(at).properties.get(key);
  if (!found) throw new Error(`no property ${key}`);
  return found;
}

const attribute = () =>
  itemSchema(property(rootSchema('entity'), 'attributes').schema);
const domain = () =>
  itemSchema(property(rootSchema('dictionary'), 'domains').schema);

describe('값의 스키마 찾기', () => {
  test('keys come in the order of properties', () => {
    expect([...shape(rootSchema('relationship')).properties.keys()]).toEqual([
      'id',
      'kind',
      'parent',
      'child',
      'name',
      'definition',
      'verbPhrase',
      'cardinality',
      'parentKey',
      'referentialIntegrity',
      'resolvedBy',
      'scope',
      'physical',
      'ext',
    ]);
  });

  test('a $ref to another file is followed (dataType from common)', () => {
    const type = property(attribute(), 'type');
    expect(type.schema.schema.$ref).toBe(
      'urn:erdmaker:format:0.1:common#/$defs/dataType',
    );
    expect(resolveSchema(type.schema)).toEqual({
      schema: commonDef('dataType'),
      document: COMMON,
    });
    expect([...shape(type.schema).properties.keys()]).toEqual([
      'base',
      'length',
      'precision',
      'scale',
    ]);
  });

  test('a same-file $ref is resolved against its own document', () => {
    // `#/$defs/attribute` inside entity.schema.json.
    const items = property(rootSchema('entity'), 'attributes').schema;
    expect(itemSchema(items)?.schema).toEqual({ $ref: '#/$defs/attribute' });
    expect([...shape(attribute()).properties.keys()]).toEqual([
      'id',
      'name',
      'definition',
      'note',
      'scope',
      'term',
      'domain',
      'type',
      'nullable',
      'default',
      'validValues',
      'physical',
      'migratedFrom',
      'rolenamed',
      'nameSource',
      'ext',
    ]);
    // `#/$defs/dbms` inside common.schema.json, reached from the dictionary.
    const physicalTypes = resolveSchema(
      property(domain(), 'physicalTypes').schema,
    );
    expect(physicalTypes.document).toBe(COMMON);
    const names = physicalTypes.schema.propertyNames as SchemaObject;
    expect(names).toEqual({ $ref: '#/$defs/dbms' });
    expect(
      resolveSchema({ schema: names, document: physicalTypes.document }).schema,
    ).toBe(commonDef('dbms'));
    // The dictionary has no `$defs`, so the same reference fails there.
    expect(() =>
      resolveSchema({
        schema: names,
        document: rootSchema('dictionary').schema,
      }),
    ).toThrow('$ref #/$defs/dbms names no schema');
  });

  test('oneOf: an object value takes the branch with properties', () => {
    for (const owner of [attribute(), domain()]) {
      const value = property(owner, 'default').schema;
      expect(resolveSchema(value).schema).toBe(commonDef('defaultValue'));
      expect([...shape(value).properties.keys()]).toEqual(['expression']);
      expect(shape(value).properties.get('expression')?.required).toBe(true);
    }
  });

  test('allOf, if, then and else define no keys', () => {
    // relationship.schema.json gives `cardinality: false` and friends under allOf/then.
    const relationship = shape(rootSchema('relationship'));
    expect(relationship.additional).toBeUndefined();
    expect(relationship.properties.get('cardinality')?.schema.schema).toBe(
      (rootSchema('relationship').schema.properties as SchemaObject)
        .cardinality,
    );
    expect([
      ...shape(
        property(rootSchema('relationship'), 'cardinality').schema,
      ).properties.keys(),
    ]).toEqual(['parent', 'child', 'count']);
  });

  test('a map value takes the additionalProperties schema', () => {
    const nodes = property(rootSchema('layout'), 'nodes').schema;
    expect(shape(nodes).properties.size).toBe(0);
    expect([...shape(shape(nodes).additional).properties.keys()]).toEqual([
      'x',
      'y',
      'width',
      'height',
      'color',
    ]);
    const edge = shape(
      property(rootSchema('layout'), 'edges').schema,
    ).additional;
    expect([...shape(edge).properties.keys()]).toEqual([
      'parentSide',
      'childSide',
      'waypoints',
    ]);
    expect([
      ...shape(
        itemSchema(property(edge, 'waypoints').schema),
      ).properties.keys(),
    ]).toEqual(['x', 'y']);
    const physicalTypes = shape(property(domain(), 'physicalTypes').schema);
    expect(physicalTypes.properties.size).toBe(0);
    expect(physicalTypes.additional?.schema).toEqual({
      type: 'string',
      minLength: 1,
    });
  });

  test('a schema without keys gives none (ext)', () => {
    expect(objectSchema(property(rootSchema('entity'), 'ext').schema)).toBe(
      undefined,
    );
    expect(itemSchema(property(rootSchema('entity'), 'ext').schema)).toBe(
      undefined,
    );
  });

  test('defaults: at the key, else at a $ref target', () => {
    const at = (owner: ValueSchema | undefined, key: string) =>
      property(owner, key).default;
    expect(at(attribute(), 'nullable')).toEqual({ value: true });
    expect(at(attribute(), 'rolenamed')).toEqual({ value: false });
    expect(at(rootSchema('model'), 'notation')).toEqual({ value: 'ie' });
    expect(at(rootSchema('model'), 'dictionaries')).toEqual({
      value: ['dictionary'],
    });
    // Through the common `scope` definition.
    expect(property(rootSchema('entity'), 'scope').schema.schema.$ref).toBe(
      'urn:erdmaker:format:0.1:common#/$defs/scope',
    );
    expect(at(rootSchema('entity'), 'scope')).toEqual({ value: 'both' });
    expect(
      at(itemSchema(property(rootSchema('entity'), 'keys').schema), 'scope'),
    ).toEqual({ value: 'both' });
    // An attribute's scope has no default (FR-07).
    expect(at(attribute(), 'scope')).toBeUndefined();
    expect(at(rootSchema('model'), 'formatVersion')).toBeUndefined();
  });

  test('a key named default is a key, not the default keyword', () => {
    expect(shape(attribute()).properties.has('default')).toBe(true);
    expect(property(attribute(), 'default').default).toBeUndefined();
    expect(property(domain(), 'default').default).toBeUndefined();
  });

  test('every default in the schemas is found, and only those', () => {
    const found: string[] = [];
    const seen = new Set<object>();
    const walk = (name: string, at: ValueSchema | undefined): void => {
      if (!at || seen.has(at.schema)) return;
      seen.add(at.schema);
      const object = objectSchema(at);
      for (const [key, value] of object?.properties ?? []) {
        if (value.default) {
          found.push(`${name}.${key}=${JSON.stringify(value.default.value)}`);
        }
        walk(`${name}.${key}`, value.schema);
        walk(`${name}.${key}[]`, itemSchema(value.schema));
      }
      walk(`${name}.*`, object?.additional);
    };
    for (const name of [
      'model',
      'entity',
      'relationship',
      'subtype',
      'subject-area',
      'layout',
      'dictionary',
    ] as const) {
      walk(name, rootSchema(name));
    }
    expect(found.sort()).toEqual([
      'dictionary.words[].classifier=false',
      'entity.attributes[].nullable=true',
      'entity.attributes[].rolenamed=false',
      'entity.keys[].scope="both"',
      'entity.scope="both"',
      'model.dictionaries=["dictionary"]',
      'model.notation="ie"',
      'model.schemas[].role="main"',
      'relationship.cardinality.child="zero-or-more"',
      'relationship.cardinality.parent="one"',
      'relationship.scope="both"',
      'subtype.completeness="incomplete"',
      'subtype.exclusivity="exclusive"',
      'subtype.scope="both"',
    ]);
  });

  test('every $ref in the schemas resolves, beside annotations only', () => {
    const ANNOTATIONS = new Set([
      '$ref',
      'description',
      'title',
      '$comment',
      'examples',
      'default',
    ]);
    const MAPS = ['properties', '$defs', 'patternProperties'];
    const ONE = [
      'items',
      'additionalProperties',
      'propertyNames',
      'not',
      'if',
      'then',
      'else',
      'contains',
    ];
    const MANY = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];
    let refs = 0;
    const walk = (schema: unknown, document: SchemaObject): void => {
      if (typeof schema !== 'object' || schema === null) return;
      const object = schema as SchemaObject;
      if (typeof object.$ref === 'string') {
        refs += 1;
        expect(
          Object.keys(object).filter((key) => !ANNOTATIONS.has(key)),
        ).toEqual([]);
        expect(() => resolveSchema({ schema: object, document })).not.toThrow();
      }
      for (const key of MAPS) {
        for (const value of Object.values((object[key] ?? {}) as object)) {
          walk(value, document);
        }
      }
      for (const key of ONE) walk(object[key], document);
      for (const key of MANY) {
        for (const value of (object[key] ?? []) as unknown[]) {
          walk(value, document);
        }
      }
    };
    for (const document of Object.values(schemaFiles)) {
      walk(document, document as SchemaObject);
    }
    // The walk reached every `$ref` the files hold.
    const written = Object.values(schemaFiles)
      .map((document) => JSON.stringify(document).split('"$ref":').length - 1)
      .reduce((sum, count) => sum + count, 0);
    expect(written).toBe(59);
    expect(refs).toBe(written);
  });

  test('the positions the writing rules name', () => {
    const layout = rootSchema('layout').schema.properties as SchemaObject;
    expect(schemaAt('layout', '/properties/nodes')).toBe(layout.nodes);
    expect(
      schemaAt(
        'layout',
        '/properties/edges/additionalProperties/properties/waypoints',
      ),
    ).toEqual({
      type: 'array',
      items: expect.any(Object),
    });
    expect(() => schemaAt('layout', '/properties/nope')).toThrow(
      'names no schema',
    );
  });

  test('a $ref cycle or an unknown document throws', () => {
    const document = {
      $defs: { a: { $ref: '#/$defs/b' }, b: { $ref: '#/$defs/a' } },
    };
    expect(() => resolveSchema({ schema: document.$defs.a, document })).toThrow(
      '$ref cycle',
    );
    expect(() =>
      resolveSchema({ schema: { $ref: 'urn:nope#/x' }, document }),
    ).toThrow('names no schema');
  });
});
