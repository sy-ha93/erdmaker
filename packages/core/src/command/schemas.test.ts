import { describe, expect, test, vi } from 'vitest';
import { prepareSchema, schemaAjv, type SchemaName } from '../schema/ajv.js';
import { schemaAt } from '../schema/resolve.js';
import { REJECTED_INPUTS, SAMPLE_COMMANDS } from '../testing/commands.js';
import { checkCommand, commandValidator, readCommand } from './check.js';
import { oneLineMessage } from './message.js';
import { commandSchemas } from './schemas.js';
import type { Command, CommandType } from './types.js';

type Schema = Readonly<Record<string, unknown>>;

const COMMON = 'urn:erdmaker:format:0.1:common#/$defs/';

/** The 17 kinds and their fields, as spec appendix A lists them. */
const APPENDIX_A: Record<
  CommandType,
  { required: string[]; optional: string[]; set?: string[]; unset?: string[] }
> = {
  'entity.create': {
    required: ['name'],
    optional: [
      'id',
      'definition',
      'note',
      'scope',
      'nameSource',
      'physical',
      'ext',
      'subjectArea',
    ],
  },
  'entity.update': {
    required: ['id'],
    optional: ['set', 'unset'],
    set: [
      'name',
      'definition',
      'note',
      'scope',
      'nameSource',
      'physical',
      'ext',
    ],
    unset: [
      'definition',
      'note',
      'scope',
      'nameSource',
      'physical',
      'physical.name',
      'physical.schema',
      'ext',
    ],
  },
  'entity.delete': { required: ['id'], optional: [] },
  'attribute.create': {
    required: ['entity', 'name'],
    optional: [
      'id',
      'definition',
      'note',
      'scope',
      'term',
      'domain',
      'dataType',
      'nullable',
      'default',
      'validValues',
      'physical',
      'nameSource',
      'ext',
      'before',
    ],
  },
  'attribute.update': {
    required: ['entity', 'id'],
    optional: ['set', 'unset'],
    set: [
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
      'nameSource',
      'ext',
    ],
    unset: [
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
      'physical.name',
      'physical.types',
      'nameSource',
      'ext',
    ],
  },
  'attribute.delete': { required: ['entity', 'id'], optional: [] },
  'attribute.move': { required: ['entity', 'id'], optional: ['before'] },
  'key.create': {
    required: ['entity', 'kind', 'attributes'],
    optional: ['id', 'name', 'scope', 'physical', 'ext', 'before'],
  },
  'key.update': {
    required: ['entity', 'id'],
    optional: ['set', 'unset'],
    set: ['kind', 'name', 'attributes', 'scope', 'physical', 'ext'],
    unset: ['name', 'scope', 'physical', 'physical.name', 'ext'],
  },
  'key.delete': { required: ['entity', 'id'], optional: [] },
  'key.move': { required: ['entity', 'id'], optional: ['before'] },
  'subjectArea.create': {
    required: ['name'],
    optional: ['id', 'definition', 'group', 'order', 'entities', 'ext'],
  },
  'subjectArea.update': {
    required: ['id'],
    optional: ['set', 'unset'],
    set: ['name', 'definition', 'group', 'order', 'ext'],
    unset: ['definition', 'group', 'order', 'ext'],
  },
  'subjectArea.delete': { required: ['id'], optional: [] },
  'subjectArea.addEntities': { required: ['id', 'entities'], optional: [] },
  'subjectArea.removeEntities': { required: ['id', 'entities'], optional: [] },
  batch: { required: ['commands'], optional: [] },
};

const TYPES = Object.keys(APPENDIX_A) as CommandType[];

/** Where a field of a command's data lives in the format schemas, if it is a model field. */
function formatPosition(
  type: CommandType,
  field: string,
): [SchemaName, string] | undefined {
  const [target] = type.split('.');
  // The create's `dataType` is the attribute's `type`.
  const name = field === 'dataType' ? 'type' : field;
  switch (target) {
    case 'entity':
      return ['entity', `/properties/${name}`];
    case 'attribute':
      return ['entity', `/$defs/attribute/properties/${name}`];
    case 'key':
      return ['entity', `/$defs/key/properties/${name}`];
    case 'subjectArea':
      return ['subject-area', `/properties/${name}`];
    default:
      return undefined;
  }
}

/** The format's rules copied into the command schemas (spec FR-03): every other field is a `$ref` or an ID list. */
const TRANSCRIBED = new Set([
  'name',
  'definition',
  'note',
  'scope',
  'nameSource',
  'physical',
  'nullable',
  'kind',
  'order',
]);

/** The common definitions a command schema may point at (spec FR-03). */
const COMMON_SEVEN = new Set([
  'id',
  'scope',
  'dataType',
  'defaultValue',
  'validValues',
  'physicalTypes',
  'ext',
]);

const schemaOf = (type: CommandType): Schema =>
  commandSchemas[type] as unknown as Schema;
const propertiesOf = (schema: Schema): Schema => schema.properties as Schema;

/** `[field, schema, pointer]` for each model field of a command: its own and those under `set`. */
function modelFields(type: CommandType): [string, Schema, string][] {
  const fields: [string, Schema, string][] = [];
  const own = propertiesOf(schemaOf(type));
  for (const [field, schema] of Object.entries(own)) {
    if (field === 'type' || field === 'set' || field === 'unset') continue;
    fields.push([field, schema as Schema, `/properties/${field}`]);
  }
  const set = own.set as Schema | undefined;
  if (set) {
    for (const [field, schema] of Object.entries(propertiesOf(set))) {
      fields.push([
        field,
        schema as Schema,
        `/properties/set/properties/${field}`,
      ]);
    }
  }
  return fields;
}

function isFrozenDeep(value: unknown): boolean {
  const pending = [value];
  while (pending.length > 0) {
    const next = pending.pop();
    if (typeof next !== 'object' || next === null) continue;
    if (!Object.isFrozen(next)) return false;
    pending.push(...Object.values(next));
  }
  return true;
}

/** The first rejection message of the input layer, one line. */
function refusal(input: unknown): string | undefined {
  const read = readCommand(input);
  return read.ok ? undefined : oneLineMessage(read.message);
}

describe('명령 스키마', () => {
  test('commandSchemas has the 17 kinds of appendix A', () => {
    expect(Object.keys(commandSchemas).sort()).toEqual([...TYPES].sort());
  });

  test('each schema is compiled once, by the one Ajv instance, from its prepared copy', () => {
    const ajv = schemaAjv();
    const compile = vi.spyOn(ajv, 'compile');
    try {
      for (const type of TYPES) {
        const validate = commandValidator(type);
        expect(commandValidator(type)).toBe(validate);
        const schema = schemaOf(type);
        expect(validate.schema).toEqual(
          prepareSchema(schema, schema as Record<string, unknown>),
        );
      }
      expect(compile).toHaveBeenCalledTimes(TYPES.length);
      for (const [index, type] of TYPES.entries()) {
        expect(compile.mock.results[index]!.value).toBe(commandValidator(type));
      }
    } finally {
      compile.mockRestore();
    }
  });

  test('a list of IDs is checked by the keyword the preparation puts in for uniqueItems', () => {
    const schema = schemaOf('subjectArea.addEntities');
    const prepared = prepareSchema(
      schema,
      schema as Record<string, unknown>,
    ) as {
      properties: { entities: Schema };
    };
    expect(prepared.properties.entities.erdmakerUniqueItems).toBe(true);
    expect(prepared.properties.entities.uniqueItems).toBeUndefined();
  });

  test('the schemas are frozen all the way down', () => {
    expect(isFrozenDeep(commandSchemas)).toBe(true);
  });

  test.each(TYPES)('%s has the fields of appendix A, and only them', (type) => {
    const fields = APPENDIX_A[type];
    const schema = schemaOf(type);
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect([...(schema.required as string[])].sort()).toEqual(
      ['type', ...fields.required].sort(),
    );
    expect(Object.keys(propertiesOf(schema)).sort()).toEqual(
      ['type', ...fields.required, ...fields.optional].sort(),
    );
    expect(propertiesOf(schema).type).toEqual({ const: type });
    const set = propertiesOf(schema).set as Schema | undefined;
    if (fields.set) {
      expect(set?.type).toBe('object');
      expect(set?.additionalProperties).toBe(false);
      expect(set?.required).toBeUndefined();
      expect(Object.keys(propertiesOf(set!)).sort()).toEqual(
        [...fields.set].sort(),
      );
    } else {
      expect(set).toBeUndefined();
    }
    const unset = propertiesOf(schema).unset as Schema | undefined;
    if (fields.unset) {
      expect(unset).toEqual({
        type: 'array',
        items: { enum: fields.unset },
        uniqueItems: true,
      });
    } else {
      expect(unset).toBeUndefined();
    }
  });

  test.each(TYPES)(
    '%s copies the format rules it does not point at',
    (type) => {
      for (const [field, schema, pointer] of modelFields(type)) {
        const at = formatPosition(type, field);
        if (typeof schema.$ref === 'string') {
          // A `$ref` stands alone and names one of the common seven.
          expect(Object.keys(schema), pointer).toEqual(['$ref']);
          expect(schema.$ref.startsWith(COMMON), pointer).toBe(true);
          expect(
            COMMON_SEVEN.has(schema.$ref.slice(COMMON.length)),
            pointer,
          ).toBe(true);
          // A model field points where the format points (`scope` of an attribute
          // has no default, so it is copied, not pointed at).
          if (at && !['entity', 'before', 'subjectArea'].includes(field)) {
            const format = schemaAt(...at);
            expect(format.$ref, `${type} ${pointer}`).toBe(schema.$ref);
          }
        } else if (schema.type === 'array' && field !== 'commands') {
          // A list of IDs, written the way the preparation takes it.
          const { minItems, ...rest } = schema;
          expect(rest, pointer).toEqual({
            type: 'array',
            items: { $ref: `${COMMON}id` },
            uniqueItems: true,
          });
          const required =
            field === 'attributes' ||
            type === 'subjectArea.addEntities' ||
            type === 'subjectArea.removeEntities';
          expect(minItems, `${type} ${pointer}`).toBe(required ? 1 : undefined);
        } else if (field !== 'commands') {
          expect(TRANSCRIBED.has(field), `${type} ${pointer}`).toBe(true);
          expect(at, pointer).toBeDefined();
          expect(schema, `${type} ${pointer}`).toEqual(schemaAt(...at!));
        }
      }
    },
  );

  test('each copied rule is found in the format schema where expected', () => {
    // The rules FR-03 names, at least once each.
    const seen = new Set<string>();
    for (const type of TYPES) {
      for (const [field, schema] of modelFields(type)) {
        if (typeof schema.$ref !== 'string' && schema.type !== 'array') {
          seen.add(`${type.split('.')[0]}.${field}`);
        }
      }
    }
    expect([...seen].sort()).toEqual(
      [
        'attribute.definition',
        'attribute.name',
        'attribute.nameSource',
        'attribute.note',
        'attribute.nullable',
        'attribute.physical',
        'attribute.scope',
        'entity.definition',
        'entity.name',
        'entity.nameSource',
        'entity.note',
        'entity.physical',
        'key.kind',
        'key.name',
        'key.physical',
        'subjectArea.definition',
        'subjectArea.name',
        'subjectArea.order',
      ].sort(),
    );
  });

  test('the domain and the data type exclude each other', () => {
    expect(schemaOf('attribute.create').not).toEqual({
      required: ['domain', 'dataType'],
    });
    const set = propertiesOf(schemaOf('attribute.update')).set as Schema;
    expect(set.not).toEqual({ required: ['domain', 'type'] });
  });

  test('a batch checks its envelope only', () => {
    expect(propertiesOf(schemaOf('batch')).commands).toEqual({
      type: 'array',
      items: { type: 'object' },
      minItems: 1,
      maxItems: 1000,
    });
    // A sub-command that breaks its own schema passes the envelope.
    expect(
      readCommand({ type: 'batch', commands: [{ type: 'entity.create' }] }).ok,
    ).toBe(true);
  });

  test('the samples cover the 17 kinds and each passes its schema', () => {
    const kinds = new Set<string>(SAMPLE_COMMANDS.map((s) => s.command.type));
    expect([...kinds].sort()).toEqual([...TYPES].sort());
    const all: Command[] = [];
    for (const sample of SAMPLE_COMMANDS) {
      all.push(...(sample.before ?? []), sample.command);
    }
    for (const command of all) {
      const read = readCommand(command);
      expect(read, command.type).toEqual({ ok: true, command });
      if (command.type === 'batch') {
        for (const sub of command.commands) {
          expect(
            checkCommand(sub as unknown as Record<string, unknown>),
          ).toEqual({
            ok: true,
            command: sub,
          });
        }
      }
    }
  });

  const typeRows = REJECTED_INPUTS.filter((row) => row.step === 'type');
  const schemaRows = REJECTED_INPUTS.filter((row) => row.step === 'schema');

  test('the refused table has the four type messages and the schema messages of appendix B', () => {
    expect(typeRows.length).toBe(4);
    expect(schemaRows.length).toBe(13);
  });

  test.each(
    [...typeRows, ...schemaRows].map((row) => [row.name, row] as const),
  )('refuses %s with its message', (_name, row) => {
    expect(refusal(row.input())).toBe(row.message);
  });

  test('a __proto__ key is refused and changes no prototype', () => {
    const input = JSON.parse(
      '{"type":"entity.create","name":"a","__proto__":{"x":1}}',
    ) as unknown;
    expect(refusal(input)).toBe('/ must NOT have additional properties');
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  test('the type is cut to 50 code units, and the cut is the only change', () => {
    expect(refusal({ type: 'x'.repeat(50) })).toBe(
      `unknown command type "${'x'.repeat(50)}"`,
    );
    expect(refusal({ type: 'x'.repeat(51) })).toBe(
      `unknown command type "${'x'.repeat(50)}…"`,
    );
    // A pair cut in two: JSON.stringify writes the lone half as an escape.
    expect(refusal({ type: `${'x'.repeat(49)}🙂` })).toBe(
      `unknown command type "${'x'.repeat(49)}\\ud83d…"`,
    );
    // An inherited name is not a kind.
    expect(refusal({ type: 'constructor' })).toBe(
      'unknown command type "constructor"',
    );
    expect(refusal({ type: '__proto__' })).toBe(
      'unknown command type "__proto__"',
    );
  });

  test('a type that is not an own property is no type', () => {
    expect(
      checkCommand(
        Object.create({ type: 'entity.delete' }) as Record<string, unknown>,
      ),
    ).toEqual({
      ok: false,
      message: 'command type must be a string',
    });
  });

  test('of several errors the first in issue order is reported, not the first Ajv found', () => {
    const input = { type: 'entity.create', name: 1, id: 'Bad', scope: 'x' };
    // Ajv reports `/name` first; issue order compares the messages.
    const validate = commandValidator('entity.create');
    expect(validate(input)).toBe(false);
    expect(validate.errors?.map((error) => error.instancePath)).toEqual([
      '/name',
      '/id',
      '/scope',
    ]);
    expect(refusal(input)).toBe(
      '/id must match pattern "^[a-z0-9][a-z0-9_-]{0,62}$"',
    );
  });

  test('an ID list, an unset list and a set are each checked', () => {
    expect(
      refusal({ type: 'subjectArea.addEntities', id: 'sales', entities: [] }),
    ).toBe('/entities must NOT have fewer than 1 items');
    expect(
      refusal({ type: 'entity.update', id: 'order', unset: ['name'] }),
    ).toBe('/unset/0 must be equal to one of the allowed values');
    expect(
      refusal({ type: 'entity.update', id: 'order', unset: ['note', 'note'] }),
    ).toBe(
      '/unset must NOT have duplicate items (items ## 0 and 1 are identical)',
    );
    expect(
      refusal({
        type: 'attribute.update',
        entity: 'order',
        id: 'cust_no',
        set: { migratedFrom: [] },
      }),
    ).toBe('/set must NOT have additional properties');
    expect(
      refusal({
        type: 'entity.update',
        id: 'order',
        set: { physical: { schema: 1 } },
      }),
    ).toBe('/set/physical/schema must be string');
    expect(refusal({ type: 'subjectArea.create', name: 'A', order: -1 })).toBe(
      '/order must be >= 0',
    );
    expect(
      refusal({
        type: 'key.create',
        entity: 'order',
        kind: 'primary',
        attributes: [],
      }),
    ).toBe('/attributes must NOT have fewer than 1 items');
    // `ext` and `physical.types` are open maps.
    expect(
      readCommand({
        type: 'attribute.update',
        entity: 'order',
        id: 'ord_dtm',
        set: {
          ext: { any: [1, { b: null }] },
          physical: { types: { postgresql: 'timestamptz' } },
        },
      }).ok,
    ).toBe(true);
    // `subjectArea.create` takes an empty list of entities, or none.
    expect(
      readCommand({ type: 'subjectArea.create', name: 'A', entities: [] }).ok,
    ).toBe(true);
    expect(readCommand({ type: 'subjectArea.create', name: 'A' }).ok).toBe(
      true,
    );
  });
});
