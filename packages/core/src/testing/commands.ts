import type { Command } from '../command/types.js';
import type { ReadonlyModel } from '../model/types.js';

/**
 * Inputs `execute` must refuse with `invalid-command` (spec AC-11, the
 * refused table), each made fresh by `input`. `step` is the step of FR-03
 * that refuses it: `shape` (1), `copy` (2), `type` (3), `schema` (4).
 * `message` is the message as `execute` returns it, one line and cut.
 */
export interface RejectedInput {
  name: string;
  step: 'shape' | 'copy' | 'type' | 'schema';
  input: () => unknown;
  message: string;
  /**
   * The message `readCommand` and `checkCommand` return, before the one-line
   * pass, when it differs from `message`. Phase 5's `execute` must turn it
   * into `message` through `oneLineMessage`.
   */
  raw?: string;
  /** Undoes what `input` changed outside the value (a prototype). */
  cleanup?: () => void;
}

/**
 * Inputs `execute` must take (spec AC-11, the accepted table). `copy` is
 * the plain copy the input layer keeps of it.
 */
export interface AcceptedInput {
  name: string;
  input: () => unknown;
  copy: () => unknown;
}

/** A sample command of each kind and where it starts (spec section 6, "표본 명령"). */
export interface SampleCommand {
  command: Command;
  /** The example model or the empty model. */
  start: 'example' | 'empty';
  /** Commands run on the start model first. */
  before?: readonly Command[];
  /**
   * The data of the items the command touches, by file, made from the
   * model just before the command (after `before`); `null` where no item
   * has that file any more (spec AC-06). Filled in phase by phase.
   */
  items?: (model: ReadonlyModel) => Readonly<Record<string, unknown>>;
}

/** The data of the item at `file` in any list of `model`; throws when there is none. */
export function dataAt(model: ReadonlyModel, file: string): unknown {
  for (const list of [
    model.entities,
    model.relationships,
    model.subtypes,
    model.subjectAreas,
    model.layouts,
  ] as const) {
    for (const item of list) if (item.file === file) return item.data;
  }
  throw new Error(`No item at ${file}`);
}

/** The data at `file` with `fields` put over it. */
const patched = (
  model: ReadonlyModel,
  file: string,
  fields: Record<string, unknown>,
): unknown => ({ ...(dataAt(model, file) as object), ...fields });

const MAX_VALUES = 100_000;
const MAX_TEXT = 1_000_000;

/** An object `levels` levels deep: `{ a: { a: … {} } }`, the innermost key named `last`. */
export function nested(levels: number, last = 'a'): Record<string, unknown> {
  let value: Record<string, unknown> = {};
  for (let level = 2; level <= levels; level += 1) {
    value = { [level === 2 ? last : 'a']: value };
  }
  return value;
}

/** `{ k0: value, k1: value, … }` with `count` keys. */
export function manyKeys(
  count: number,
  value: unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < count; i += 1) out[`k${i}`] = value;
  return out;
}

/** An `entity.create` with this `ext`: the command's own keys are 3 values. */
const withExt = (ext: unknown): Record<string, unknown> => ({
  type: 'entity.create',
  name: 'a',
  ext,
});

/** A Proxy over `target` whose `trap` alone throws. */
function throwingProxy(
  target: object,
  trap: 'get' | 'ownKeys' | 'getOwnPropertyDescriptor',
): object {
  return new Proxy(target, {
    [trap]() {
      throw new Error(`${trap} trap`);
    },
  });
}

class Rows extends Array<unknown> {}

const LONG_KEY = 'k'.repeat(600);

/** The text of `"entity.create"`, `"type"`, `"name"`: the rest of a 1000000 text total goes in `name`. */
const NAME_FOR_TEXT =
  MAX_TEXT - 'type'.length - 'entity.create'.length - 'name'.length;

export const REJECTED_INPUTS: readonly RejectedInput[] = [
  {
    name: 'null',
    step: 'shape',
    input: () => null,
    message: 'command must be an object',
  },
  {
    name: 'an array',
    step: 'shape',
    input: () => [],
    message: 'command must be an object',
  },
  {
    name: 'a string',
    step: 'shape',
    input: () => 'x',
    message: 'command must be an object',
  },
  {
    name: 'a number',
    step: 'shape',
    input: () => 42,
    message: 'command must be an object',
  },
  {
    name: 'undefined',
    step: 'shape',
    input: () => undefined,
    message: 'command must be an object',
  },
  {
    name: 'a function as the command',
    step: 'shape',
    input: () => () => ({ type: 'entity.create', name: 'a' }),
    message: 'command must be an object',
  },
  {
    name: 'a Date as the command',
    step: 'copy',
    input: () => new Date(0),
    message: '/ must be a JSON value',
  },
  {
    name: 'a Date in ext',
    step: 'copy',
    input: () => withExt({ d: new Date(0) }),
    message: '/ext/d must be a JSON value',
  },
  {
    name: 'a function in ext',
    step: 'copy',
    input: () => withExt({ f: () => 1 }),
    message: '/ext/f must be a JSON value',
  },
  {
    name: 'NaN in ext',
    step: 'copy',
    input: () => withExt({ n: NaN }),
    message: '/ext/n must be a JSON value',
  },
  {
    name: 'an array with a hole',
    step: 'copy',
    // eslint-disable-next-line no-sparse-arrays
    input: () => withExt({ a: [1, , 2] }),
    message: '/ext/a/1 must be a JSON value',
  },
  {
    name: 'undefined in an array',
    step: 'copy',
    input: () => withExt({ a: [undefined] }),
    message: '/ext/a/0 must be a JSON value',
  },
  {
    name: 'an instance of an Array subclass',
    step: 'copy',
    input: () => withExt({ a: Rows.from([1]) }),
    message: '/ext/a must be a JSON value',
  },
  {
    name: 'an array whose index 0 is a getter',
    step: 'copy',
    input: () =>
      withExt({
        a: Object.defineProperty([], 0, { get: () => 1, enumerable: true }),
      }),
    message: '/ext/a/0 must be a JSON value',
  },
  {
    name: 'an array that inherits its index 0 from the prototype',
    step: 'copy',
    input: () => {
      Object.defineProperty(Array.prototype, 0, {
        value: 'inherited',
        configurable: true,
        writable: true,
      });
      const a: unknown[] = [];
      a.length = 1;
      return withExt({ a });
    },
    message: '/ext/a/0 must be a JSON value',
    cleanup: () => {
      delete (Array.prototype as unknown as Record<number, unknown>)[0];
    },
  },
  {
    name: 'a command whose get trap throws',
    step: 'copy',
    input: () => throwingProxy({ type: 'entity.create', name: 'a' }, 'get'),
    message: '/type must be a JSON value',
  },
  {
    name: 'a command whose ownKeys trap throws',
    step: 'copy',
    input: () => throwingProxy({ type: 'entity.create', name: 'a' }, 'ownKeys'),
    message: '/ must be a JSON value',
  },
  {
    name: 'a command whose descriptor trap throws',
    step: 'copy',
    input: () =>
      throwingProxy(
        { type: 'entity.create', name: 'a' },
        'getOwnPropertyDescriptor',
      ),
    message: '/ must be a JSON value',
  },
  {
    name: 'an ext whose get trap throws',
    step: 'copy',
    input: () => withExt(throwingProxy({ a: 1 }, 'get')),
    message: '/ext/a must be a JSON value',
  },
  {
    name: 'an ext whose ownKeys trap throws',
    step: 'copy',
    input: () => withExt(throwingProxy({ a: 1 }, 'ownKeys')),
    message: '/ext must be a JSON value',
  },
  {
    name: 'an ext whose descriptor trap throws',
    step: 'copy',
    input: () => withExt(throwingProxy({ a: 1 }, 'getOwnPropertyDescriptor')),
    message: '/ext must be a JSON value',
  },
  {
    name: 'an ext that holds itself',
    step: 'copy',
    input: () => {
      const ext: Record<string, unknown> = {};
      ext.self = ext;
      return withExt(ext);
    },
    message: 'command is nested more than 32 levels deep',
  },
  {
    name: '33 levels',
    step: 'copy',
    // The command is level 1, `ext` level 2, its innermost object level 33.
    input: () => withExt(nested(32)),
    message: 'command is nested more than 32 levels deep',
  },
  {
    name: '100001 values',
    step: 'copy',
    input: () => withExt(manyKeys(MAX_VALUES - 2, 0)),
    message: 'command has more than 100000 values',
  },
  {
    name: '1000001 characters of text',
    step: 'copy',
    input: () => ({
      type: 'entity.create',
      name: 'n'.repeat(NAME_FOR_TEXT + 1),
    }),
    message: 'command has more than 1000000 characters of text',
  },
  {
    name: '100001 keys whose values are all undefined',
    step: 'copy',
    input: () => withExt(manyKeys(MAX_VALUES - 2, undefined)),
    message: 'command has more than 100000 values',
  },
  {
    name: 'too many values, then a Date',
    step: 'copy',
    input: () => withExt({ ...manyKeys(MAX_VALUES - 2, 0), d: new Date(0) }),
    message: 'command has more than 100000 values',
  },
  {
    name: 'the container at level 33 is also the 100001st value',
    step: 'copy',
    // type, name, ext, 99967 keys, then the 31 keys down to level 33.
    input: () =>
      withExt({ ...manyKeys(MAX_VALUES + 1 - 3 - 31, 0), deep: nested(31) }),
    message: 'command is nested more than 32 levels deep',
  },
  {
    name: 'no type',
    step: 'type',
    input: () => ({ name: 'a' }),
    message: 'command type must be a string',
  },
  {
    name: 'a type that is not a string',
    step: 'type',
    input: () => ({ type: 1, name: 'a' }),
    message: 'command type must be a string',
  },
  {
    name: 'an unknown type',
    step: 'type',
    input: () => ({ type: 'entity.rename', id: 'a' }),
    message: 'unknown command type "entity.rename"',
  },
  {
    name: 'a type of 100 characters with a line break',
    step: 'type',
    input: () => ({ type: `a\n${'b'.repeat(98)}` }),
    message: `unknown command type "a\\n${'b'.repeat(48)}…"`,
  },
  {
    name: 'a type with a line separator',
    step: 'type',
    input: () => ({ type: 'entity\u2028x' }),
    raw: 'unknown command type "entity\u2028x"',
    message: 'unknown command type "entity\\u{2028}x"',
  },
  {
    name: 'a message longer than 500 code points',
    step: 'copy',
    input: () => withExt({ [LONG_KEY]: () => 1 }),
    message: `${`/ext/${LONG_KEY} must be a JSON value`.slice(0, 500)}…`,
  },
  {
    name: 'an unknown key',
    step: 'schema',
    input: () => ({ type: 'entity.create', name: 'a', foo: 1 }),
    message: '/ must NOT have additional properties',
  },
  {
    name: 'an unknown key in set',
    step: 'schema',
    input: () => ({ type: 'entity.update', id: 'order', set: { id: 'b' } }),
    message: '/set must NOT have additional properties',
  },
  {
    name: 'a missing required key',
    step: 'schema',
    input: () => ({ type: 'entity.create' }),
    message: "/ must have required property 'name'",
  },
  {
    name: 'a missing required key and an unknown key',
    step: 'schema',
    input: () => ({ type: 'attribute.create', entity: 'order', foo: 1 }),
    message: '/ must NOT have additional properties',
  },
  {
    name: 'a name that is not a string',
    step: 'schema',
    input: () => ({ type: 'entity.create', name: 1 }),
    message: '/name must be string',
  },
  {
    name: 'an empty name',
    step: 'schema',
    input: () => ({ type: 'entity.create', name: '' }),
    message: '/name must NOT have fewer than 1 characters',
  },
  {
    name: 'a domain and a data type in a create',
    step: 'schema',
    input: () => ({
      type: 'attribute.create',
      entity: 'order',
      name: 'x',
      domain: 'number',
      dataType: { base: 'string' },
    }),
    message: '/ must NOT be valid',
  },
  {
    name: 'a domain and a type in an update',
    step: 'schema',
    input: () => ({
      type: 'attribute.update',
      entity: 'order',
      id: 'ord_dtm',
      set: { domain: 'number', type: { base: 'string' } },
    }),
    message: '/set must NOT be valid',
  },
  {
    name: 'the same entity twice',
    step: 'schema',
    input: () => ({
      type: 'subjectArea.addEntities',
      id: 'sales',
      entities: ['tag', 'tag'],
    }),
    message:
      '/entities must NOT have duplicate items (items ## 0 and 1 are identical)',
  },
  {
    name: 'an empty batch',
    step: 'schema',
    input: () => ({ type: 'batch', commands: [] }),
    message: '/commands must NOT have fewer than 1 items',
  },
  {
    name: 'a batch of 1001 commands',
    step: 'schema',
    input: () => ({
      type: 'batch',
      commands: Array.from({ length: 1001 }, () => ({
        type: 'entity.delete',
        id: 'a',
      })),
    }),
    message: '/commands must NOT have more than 1000 items',
  },
  {
    name: 'a batch holding a number',
    step: 'schema',
    input: () => ({ type: 'batch', commands: [1] }),
    message: '/commands/0 must be object',
  },
  {
    name: 'a __proto__ key from JSON.parse',
    step: 'schema',
    input: (): unknown =>
      JSON.parse('{"type":"entity.create","name":"a","__proto__":{"x":1}}'),
    message: '/ must NOT have additional properties',
  },
];

/** `JSON.parse` keeps `__proto__` as an own key, as the copy must. */
const protoExt = (): unknown =>
  JSON.parse('{"type":"entity.create","name":"a","ext":{"__proto__":{"x":1}}}');

export const ACCEPTED_INPUTS: readonly AcceptedInput[] = [
  {
    name: 'exactly 32 levels',
    input: () => withExt(nested(31)),
    copy: () => withExt(nested(31)),
  },
  {
    name: 'exactly 100000 values',
    input: () => withExt(manyKeys(MAX_VALUES - 3, 0)),
    copy: () => withExt(manyKeys(MAX_VALUES - 3, 0)),
  },
  {
    name: 'exactly 1000000 characters of text',
    input: () => ({ type: 'entity.create', name: 'n'.repeat(NAME_FOR_TEXT) }),
    copy: () => ({ type: 'entity.create', name: 'n'.repeat(NAME_FOR_TEXT) }),
  },
  {
    name: 'properties whose value is undefined',
    input: () => ({
      type: 'entity.create',
      name: 'a',
      definition: undefined,
      ext: { x: undefined, y: 1 },
    }),
    copy: () => ({ type: 'entity.create', name: 'a', ext: { y: 1 } }),
  },
  {
    name: 'an array with own properties that are not indexes',
    input: () => ({
      type: 'subjectArea.create',
      name: 'A',
      entities: Object.assign(['product'], { extra: 'address' }),
    }),
    copy: () => ({
      type: 'subjectArea.create',
      name: 'A',
      entities: ['product'],
    }),
  },
  {
    name: 'a __proto__ key in ext from JSON.parse',
    input: protoExt,
    copy: protoExt,
  },
  {
    name: 'an array with a toJSON method',
    input: () => ({
      type: 'subjectArea.create',
      name: 'A',
      entities: Object.assign(['product'], {
        toJSON() {
          return ['address'];
        },
      }),
    }),
    copy: () => ({
      type: 'subjectArea.create',
      name: 'A',
      entities: ['product'],
    }),
  },
];

/** One sample or more of each of the 17 kinds (spec section 6). Expected results come in later steps. */
export const SAMPLE_COMMANDS: readonly SampleCommand[] = [
  {
    start: 'example',
    command: { type: 'entity.create', name: '배송', subjectArea: 'sales' },
    items: (model) => ({
      'entities/baesong.yaml': { id: 'baesong', name: '배송', attributes: [] },
      'subject-areas/sales.yaml': patched(model, 'subject-areas/sales.yaml', {
        entities: [
          'address',
          'customer',
          'order',
          'order_item',
          'product',
          'baesong',
        ],
      }),
    }),
  },
  {
    start: 'example',
    command: {
      type: 'entity.update',
      id: 'order',
      set: { definition: '고객이 한 번에 결제하는 주문.' },
    },
    items: (model) => ({
      'entities/order.yaml': patched(model, 'entities/order.yaml', {
        definition: '고객이 한 번에 결제하는 주문.',
      }),
    }),
  },
  {
    start: 'empty',
    before: [{ type: 'entity.create', id: 'a', name: 'A' }],
    command: { type: 'entity.delete', id: 'a' },
    items: () => ({ 'entities/a.yaml': null }),
  },
  {
    start: 'example',
    command: {
      type: 'attribute.create',
      entity: 'order',
      name: '메모',
      id: 'memo',
      dataType: { base: 'string', length: 200 },
      before: 'created_at',
    },
  },
  {
    start: 'example',
    command: {
      type: 'attribute.update',
      entity: 'order',
      id: 'ord_dtm',
      set: { definition: '주문한 시각.' },
    },
  },
  {
    start: 'example',
    command: { type: 'attribute.delete', entity: 'order', id: 'total_amt' },
  },
  {
    start: 'example',
    command: {
      type: 'attribute.move',
      entity: 'order',
      id: 'total_amt',
      before: 'ord_dtm',
    },
  },
  {
    start: 'example',
    command: {
      type: 'key.create',
      entity: 'order',
      kind: 'alternate',
      id: 'ak_ord_dtm',
      attributes: ['ord_dtm'],
    },
  },
  {
    start: 'example',
    command: {
      type: 'key.update',
      entity: 'order',
      id: 'ie_ord_dtm',
      set: { name: '고객별 주문일시' },
    },
  },
  {
    start: 'example',
    command: { type: 'key.delete', entity: 'order', id: 'ie_ord_dtm' },
  },
  {
    start: 'example',
    command: {
      type: 'key.move',
      entity: 'order',
      id: 'ie_ord_dtm',
      before: 'pk',
    },
  },
  {
    start: 'example',
    command: {
      type: 'subjectArea.create',
      name: '배송',
      entities: ['order', 'address'],
    },
  },
  {
    start: 'example',
    command: { type: 'subjectArea.update', id: 'sales', set: { name: '판매' } },
  },
  {
    start: 'example',
    command: { type: 'subjectArea.delete', id: 'sales' },
  },
  {
    start: 'example',
    command: {
      type: 'subjectArea.addEntities',
      id: 'sales',
      entities: ['tag'],
    },
  },
  {
    start: 'example',
    command: {
      type: 'subjectArea.removeEntities',
      id: 'sales',
      entities: ['order'],
    },
  },
  {
    start: 'empty',
    command: {
      type: 'batch',
      commands: [
        { type: 'entity.create', id: 'a', name: 'A' },
        {
          type: 'attribute.create',
          entity: 'a',
          id: 'a_no',
          name: 'A 번호',
          dataType: { base: 'integer' },
          nullable: false,
        },
        {
          type: 'key.create',
          entity: 'a',
          kind: 'primary',
          attributes: ['a_no'],
        },
      ],
    },
  },
];
