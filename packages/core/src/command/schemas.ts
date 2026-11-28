import type { CommandType } from './types.js';

/** A JSON Schema as written here: plain data, frozen when the module loads. */
export type CommandSchema = { readonly [keyword: string]: unknown };

const COMMON = 'urn:erdmaker:format:0.1:common#/$defs/';

/** One of the common definitions a command may point at (spec FR-03). */
type Common =
  | 'id'
  | 'scope'
  | 'dataType'
  | 'defaultValue'
  | 'validValues'
  | 'physicalTypes'
  | 'ext';

const ref = (name: Common): CommandSchema => ({ $ref: `${COMMON}${name}` });

/** A list of distinct IDs, as the schema preparation takes it (no keyword beside the `$ref`). */
const idList = (nonEmpty: boolean): CommandSchema => ({
  type: 'array',
  items: ref('id'),
  uniqueItems: true,
  ...(nonEmpty ? { minItems: 1 } : {}),
});

const ID = ref('id');
const SCOPE = ref('scope');
const EXT = ref('ext');

// The rules below are copied from the format schemas, word for word; a test
// compares each with the place it came from (`schemaAt`).

const TEXT: CommandSchema = { type: 'string' };

const NAME_SOURCE_VALUES = ['manual', 'comment', 'dictionary', 'inferred'];

/** `entity` `/properties/name`. */
const ENTITY_NAME: CommandSchema = {
  type: 'string',
  minLength: 1,
  description: 'Logical name.',
};

/** `entity` `/properties/nameSource`. */
const ENTITY_NAME_SOURCE: CommandSchema = { enum: NAME_SOURCE_VALUES };

/** `entity` `/properties/physical`. */
const ENTITY_PHYSICAL: CommandSchema = {
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    name: { type: 'string', minLength: 1 },
    schema: { type: 'string' },
  },
};

/** `entity` `/$defs/attribute/properties/name`. */
const ATTRIBUTE_NAME: CommandSchema = {
  type: 'string',
  minLength: 1,
  description:
    'Logical name. For a migrated attribute with rolenamed=true this is the rolename.',
};

/** `entity` `/$defs/attribute/properties/scope`: no default, unlike the common one. */
const ATTRIBUTE_SCOPE: CommandSchema = {
  description:
    'both = exists in the logical and the physical model; logical = logical only; physical = physical only. Absent: inherits the scope of the entity.',
  enum: ['both', 'logical', 'physical'],
};

/** `entity` `/$defs/attribute/properties/nullable`. */
const ATTRIBUTE_NULLABLE: CommandSchema = { type: 'boolean', default: true };

/** `entity` `/$defs/attribute/properties/physical`. */
const ATTRIBUTE_PHYSICAL: CommandSchema = {
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    name: { type: 'string', minLength: 1 },
    types: ref('physicalTypes'),
  },
};

/** `entity` `/$defs/attribute/properties/nameSource`. */
const ATTRIBUTE_NAME_SOURCE: CommandSchema = {
  enum: NAME_SOURCE_VALUES,
  description: 'Where the logical name came from.',
};

/** `entity` `/$defs/key/properties/kind`. */
const KEY_KIND: CommandSchema = {
  enum: ['primary', 'alternate', 'inversion'],
  description:
    'primary = PK, alternate = AK (unique), inversion = IE (non-unique index).',
};

/** `entity` `/$defs/key/properties/name`. */
const KEY_NAME: CommandSchema = { type: 'string' };

/** `entity` `/$defs/key/properties/physical`. */
const KEY_PHYSICAL: CommandSchema = {
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    name: { type: 'string', minLength: 1 },
  },
};

/** `subject-area` `/properties/name`. */
const AREA_NAME: CommandSchema = { type: 'string', minLength: 1 };

/** `subject-area` `/properties/order`. */
const AREA_ORDER: CommandSchema = {
  type: 'integer',
  minimum: 0,
  description:
    'Display order within the group (or among ungrouped areas). Ties and missing values sort by id.',
};

/** A command record: `type` first, then the fields of spec appendix A. */
function command(
  type: CommandType,
  required: readonly string[],
  properties: Readonly<Record<string, CommandSchema>>,
  rest: Readonly<Record<string, unknown>> = {},
): CommandSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['type', ...required],
    properties: { type: { const: type }, ...properties },
    ...rest,
  };
}

/** A `set` record: every field optional. */
const set = (
  properties: Readonly<Record<string, CommandSchema>>,
  rest: Readonly<Record<string, unknown>> = {},
): CommandSchema => ({
  type: 'object',
  additionalProperties: false,
  properties,
  ...rest,
});

/** An `unset` list: distinct names from the list. */
const unset = (names: readonly string[]): CommandSchema => ({
  type: 'array',
  items: { enum: names },
  uniqueItems: true,
});

const ENTITY_FIELDS = {
  definition: TEXT,
  note: TEXT,
  scope: SCOPE,
  nameSource: ENTITY_NAME_SOURCE,
  physical: ENTITY_PHYSICAL,
  ext: EXT,
};

const ATTRIBUTE_FIELDS = {
  definition: TEXT,
  note: TEXT,
  scope: ATTRIBUTE_SCOPE,
  term: ID,
  domain: ID,
};

const ATTRIBUTE_MORE = {
  nullable: ATTRIBUTE_NULLABLE,
  default: ref('defaultValue'),
  validValues: ref('validValues'),
  physical: ATTRIBUTE_PHYSICAL,
  nameSource: ATTRIBUTE_NAME_SOURCE,
  ext: EXT,
};

const AREA_FIELDS = {
  definition: TEXT,
  group: ID,
  order: AREA_ORDER,
};

/** Deep-freezes `value`, walking with a stack. */
function freeze<T>(value: T): T {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const next = pending.pop();
    if (typeof next !== 'object' || next === null || Object.isFrozen(next)) {
      continue;
    }
    Object.freeze(next);
    pending.push(...Object.values(next));
  }
  return value;
}

/**
 * The JSON Schema of each command (spec FR-03, appendix A), before the schema
 * preparation. Model values point at the format's common definitions or copy
 * the format's rules. Frozen all the way down: they are compiled on first
 * use, so a change before that would change the check.
 */
export const commandSchemas: { readonly [T in CommandType]: CommandSchema } =
  freeze({
    'entity.create': command('entity.create', ['name'], {
      name: ENTITY_NAME,
      id: ID,
      ...ENTITY_FIELDS,
      subjectArea: ID,
    }),
    'entity.update': command('entity.update', ['id'], {
      id: ID,
      set: set({ name: ENTITY_NAME, ...ENTITY_FIELDS }),
      unset: unset([
        'definition',
        'note',
        'scope',
        'nameSource',
        'physical',
        'physical.name',
        'physical.schema',
        'ext',
      ]),
    }),
    'entity.delete': command('entity.delete', ['id'], { id: ID }),
    'attribute.create': command(
      'attribute.create',
      ['entity', 'name'],
      {
        entity: ID,
        name: ATTRIBUTE_NAME,
        id: ID,
        ...ATTRIBUTE_FIELDS,
        dataType: ref('dataType'),
        ...ATTRIBUTE_MORE,
        before: ID,
      },
      { not: { required: ['domain', 'dataType'] } },
    ),
    'attribute.update': command('attribute.update', ['entity', 'id'], {
      entity: ID,
      id: ID,
      set: set(
        {
          name: ATTRIBUTE_NAME,
          ...ATTRIBUTE_FIELDS,
          type: ref('dataType'),
          ...ATTRIBUTE_MORE,
        },
        { not: { required: ['domain', 'type'] } },
      ),
      unset: unset([
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
      ]),
    }),
    'attribute.delete': command('attribute.delete', ['entity', 'id'], {
      entity: ID,
      id: ID,
    }),
    'attribute.move': command('attribute.move', ['entity', 'id'], {
      entity: ID,
      id: ID,
      before: ID,
    }),
    'key.create': command('key.create', ['entity', 'kind', 'attributes'], {
      entity: ID,
      kind: KEY_KIND,
      attributes: idList(true),
      id: ID,
      name: KEY_NAME,
      scope: SCOPE,
      physical: KEY_PHYSICAL,
      ext: EXT,
      before: ID,
    }),
    'key.update': command('key.update', ['entity', 'id'], {
      entity: ID,
      id: ID,
      set: set({
        kind: KEY_KIND,
        name: KEY_NAME,
        attributes: idList(true),
        scope: SCOPE,
        physical: KEY_PHYSICAL,
        ext: EXT,
      }),
      unset: unset(['name', 'scope', 'physical', 'physical.name', 'ext']),
    }),
    'key.delete': command('key.delete', ['entity', 'id'], {
      entity: ID,
      id: ID,
    }),
    'key.move': command('key.move', ['entity', 'id'], {
      entity: ID,
      id: ID,
      before: ID,
    }),
    'subjectArea.create': command('subjectArea.create', ['name'], {
      name: AREA_NAME,
      id: ID,
      ...AREA_FIELDS,
      entities: idList(false),
      ext: EXT,
    }),
    'subjectArea.update': command('subjectArea.update', ['id'], {
      id: ID,
      set: set({ name: AREA_NAME, ...AREA_FIELDS, ext: EXT }),
      unset: unset(['definition', 'group', 'order', 'ext']),
    }),
    'subjectArea.delete': command('subjectArea.delete', ['id'], { id: ID }),
    'subjectArea.addEntities': command(
      'subjectArea.addEntities',
      ['id', 'entities'],
      { id: ID, entities: idList(true) },
    ),
    'subjectArea.removeEntities': command(
      'subjectArea.removeEntities',
      ['id', 'entities'],
      { id: ID, entities: idList(true) },
    ),
    // The envelope only: each sub-command is checked against its own schema (spec FR-08).
    batch: command('batch', ['commands'], {
      commands: {
        type: 'array',
        items: { type: 'object' },
        minItems: 1,
        maxItems: 1000,
      },
    }),
  });
