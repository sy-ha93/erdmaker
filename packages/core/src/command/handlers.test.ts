import { describe, expect, test } from 'vitest';
import type { EntityData, ReadonlyModel } from '../model/types.js';
import { dataAt, SAMPLE_COMMANDS } from '../testing/commands.js';
import {
  areaItem,
  emptyModel,
  entityItem,
  exampleModel,
  handModel,
  succeeded,
} from '../testing/editing.js';
import { createEditor } from './editor.js';
import { commandSchemas } from './schemas.js';
import type { Editor } from './types.js';

const ORDER = 'entities/order.yaml';

/** The data of the item at `file`, or `null` when no item has it. */
function itemData(model: ReadonlyModel, file: string): unknown {
  try {
    return dataAt(model, file);
  } catch {
    return null;
  }
}

async function exampleEditor(): Promise<Editor> {
  return createEditor(await exampleModel());
}

const order = (editor: Editor) => dataAt(editor.model, ORDER) as EntityData;

/** The attribute of `data` with this id. */
const attribute = (data: EntityData, id: string) =>
  data.attributes.find((a) => a.id === id)!;

/** Runs `command` and expects a change, returning the new order data. */
function changed(editor: Editor, command: unknown): EntityData {
  const before = editor.model;
  const result = editor.execute(command);
  expect(result.ok).toBe(true);
  expect(succeeded(result).model).not.toBe(before);
  expect(editor.canUndo).toBe(true);
  return order(editor);
}

describe('명령 동작', () => {
  const samples = SAMPLE_COMMANDS.filter((sample) => sample.items);
  test.each(samples.map((sample) => [sample.command.type, sample] as const))(
    'the sample %s gives the expected items',
    async (_type, sample) => {
      const editor = createEditor(
        sample.start === 'example' ? await exampleModel() : await emptyModel(),
      );
      for (const command of sample.before ?? []) {
        expect(editor.execute(command).ok).toBe(true);
      }
      const expected = sample.items!(editor.model);
      const result = editor.execute(sample.command);
      expect(result.ok).toBe(true);
      for (const [file, data] of Object.entries(expected)) {
        expect(itemData(editor.model, file)).toEqual(data);
      }
    },
  );

  test('the samples cover the 17 kinds, each with its expected items', () => {
    const kinds = new Set(SAMPLE_COMMANDS.map((sample) => sample.command.type));
    expect([...kinds].sort()).toEqual([...Object.keys(commandSchemas)].sort());
    expect(kinds.size).toBe(17);
    for (const sample of SAMPLE_COMMANDS) expect(sample.items).toBeDefined();
  });

  test('attribute.update: unset removes a key; unsetting the last key of physical removes physical', async () => {
    const editor = await exampleEditor();
    const without = changed(editor, {
      type: 'attribute.update',
      entity: 'order',
      id: 'total_amt',
      unset: ['definition'],
    });
    expect('definition' in attribute(without, 'total_amt')).toBe(false);
    const bare = changed(editor, {
      type: 'attribute.update',
      entity: 'order',
      id: 'ord_dtm',
      unset: ['physical.name'],
    });
    expect('physical' in attribute(bare, 'ord_dtm')).toBe(false);
  });

  test('attribute.update: set.domain drops type, set.type drops domain, unset domain with set.type keeps type', async () => {
    const editor = await exampleEditor();
    const typed = changed(editor, {
      type: 'attribute.update',
      entity: 'order',
      id: 'ord_dtm',
      set: { type: { base: 'datetime' } },
    });
    expect(attribute(typed, 'ord_dtm').type).toEqual({ base: 'datetime' });
    expect('domain' in attribute(typed, 'ord_dtm')).toBe(false);
    const domained = changed(editor, {
      type: 'attribute.update',
      entity: 'order',
      id: 'ord_dtm',
      set: { domain: 'datetime' },
    });
    expect(attribute(domained, 'ord_dtm').domain).toBe('datetime');
    expect('type' in attribute(domained, 'ord_dtm')).toBe(false);
    const both = changed(editor, {
      type: 'attribute.update',
      entity: 'order',
      id: 'ord_dtm',
      unset: ['domain'],
      set: { type: { base: 'date' } },
    });
    expect(attribute(both, 'ord_dtm')).toEqual({
      id: 'ord_dtm',
      name: '주문일시',
      term: 'ord_dtm',
      type: { base: 'date' },
      nullable: false,
      physical: { name: 'ORD_DTM' },
    });
  });

  test('attribute.update: set.ext and set.physical.types replace whole, set.physical goes key by key', () => {
    const editor = createEditor(
      handModel({
        entities: [
          entityItem('e', {
            attributes: [
              {
                id: 'a',
                name: 'A',
                physical: { name: 'A', types: { pg: 'int' } },
                ext: { x: 1, y: 2 },
              },
            ],
          }),
        ],
      }),
    );
    expect(
      editor.execute({
        type: 'attribute.update',
        entity: 'e',
        id: 'a',
        set: { ext: { z: 3 }, physical: { types: { my: 'int' } } },
      }).ok,
    ).toBe(true);
    expect(editor.model.entities[0]!.data.attributes[0]).toEqual({
      id: 'a',
      name: 'A',
      physical: { name: 'A', types: { my: 'int' } },
      ext: { z: 3 },
    });
  });

  test('attribute.create and key.create with before; attribute.move and key.move forward and to the end', async () => {
    const editor = await exampleEditor();
    const ids = (data: EntityData) => data.attributes.map((a) => a.id);
    const keyIds = (data: EntityData) => data.keys!.map((k) => k.id);
    let data = changed(editor, {
      type: 'attribute.create',
      entity: 'order',
      id: 'memo',
      name: '메모',
      before: 'ord_no',
    });
    expect(ids(data)).toEqual([
      'memo',
      'ord_no',
      'cust_no',
      'ship_addr_no',
      'bill_addr_no',
      'ord_dtm',
      'total_amt',
      'created_at',
    ]);
    data = changed(editor, {
      type: 'attribute.move',
      entity: 'order',
      id: 'memo',
    });
    expect(ids(data).at(-1)).toBe('memo');
    data = changed(editor, {
      type: 'attribute.move',
      entity: 'order',
      id: 'created_at',
      before: 'ord_no',
    });
    expect(ids(data)).toEqual([
      'created_at',
      'ord_no',
      'cust_no',
      'ship_addr_no',
      'bill_addr_no',
      'ord_dtm',
      'total_amt',
      'memo',
    ]);
    // Backward: an earlier attribute before a later one.
    data = changed(editor, {
      type: 'attribute.move',
      entity: 'order',
      id: 'created_at',
      before: 'memo',
    });
    expect(ids(data).slice(-2)).toEqual(['created_at', 'memo']);

    data = changed(editor, {
      type: 'key.create',
      entity: 'order',
      kind: 'alternate',
      attributes: ['ord_dtm'],
      before: 'ie_ord_dtm',
    });
    expect(keyIds(data)).toEqual(['pk', 'ak', 'ie_ord_dtm']);
    data = changed(editor, { type: 'key.move', entity: 'order', id: 'pk' });
    expect(keyIds(data)).toEqual(['ak', 'ie_ord_dtm', 'pk']);
    data = changed(editor, {
      type: 'key.move',
      entity: 'order',
      id: 'pk',
      before: 'ak',
    });
    expect(keyIds(data)).toEqual(['pk', 'ak', 'ie_ord_dtm']);
  });

  test('commands that change nothing keep the model and the history', async () => {
    const editor = await exampleEditor();
    // One step of history, so a kept history shows.
    editor.execute({ type: 'entity.update', id: 'order', set: { note: 'n' } });
    const model = editor.model;
    const cases: unknown[] = [
      { type: 'attribute.update', entity: 'order', id: 'ord_dtm', set: {} },
      { type: 'attribute.update', entity: 'order', id: 'ord_dtm' },
      {
        type: 'attribute.update',
        entity: 'order',
        id: 'ord_dtm',
        set: { name: '주문일시' },
      },
      {
        type: 'attribute.update',
        entity: 'order',
        id: 'ord_dtm',
        set: { physical: {} },
      },
      { type: 'key.update', entity: 'order', id: 'pk', set: {} },
      { type: 'key.update', entity: 'order', id: 'pk', set: { scope: 'both' } },
      { type: 'subjectArea.update', id: 'sales', set: { name: '주문' } },
      { type: 'subjectArea.update', id: 'sales' },
      {
        type: 'attribute.move',
        entity: 'order',
        id: 'ord_dtm',
        before: 'ord_dtm',
      },
      { type: 'key.move', entity: 'order', id: 'pk', before: 'pk' },
      // Already directly before it, and already last.
      {
        type: 'attribute.move',
        entity: 'order',
        id: 'ord_dtm',
        before: 'total_amt',
      },
      { type: 'key.move', entity: 'order', id: 'ie_ord_dtm' },
      { type: 'subjectArea.addEntities', id: 'sales', entities: ['order'] },
      { type: 'subjectArea.removeEntities', id: 'sales', entities: ['tag'] },
    ];
    for (const command of cases) {
      const result = editor.execute(command);
      expect(result).toEqual({ ok: true, model, issues: [] });
      expect(succeeded(result).model).toBe(model);
      expect(editor.canUndo).toBe(true);
      expect(editor.canRedo).toBe(false);
    }
    editor.undo();
    expect(editor.canUndo).toBe(false);
  });

  test('set.physical with only the order of physical.types changed, and an attribute set.scope both, are changes', () => {
    const start = () =>
      createEditor(
        handModel({
          entities: [
            entityItem('e', {
              attributes: [
                {
                  id: 'a',
                  name: 'A',
                  physical: { types: { pg: 'a', my: 'b' } },
                },
              ],
            }),
          ],
        }),
      );
    const reordered = start();
    let model = reordered.model;
    let result = reordered.execute({
      type: 'attribute.update',
      entity: 'e',
      id: 'a',
      set: { physical: { types: { my: 'b', pg: 'a' } } },
    });
    expect(succeeded(result).model).not.toBe(model);
    const scoped = start();
    model = scoped.model;
    result = scoped.execute({
      type: 'attribute.update',
      entity: 'e',
      id: 'a',
      set: { scope: 'both' },
    });
    expect(succeeded(result).model).not.toBe(model);
    expect(scoped.model.entities[0]!.data.attributes[0]!.scope).toBe('both');
  });

  test('attribute.create leaves physical: {} and keys: [] that it did not touch', async () => {
    const editor = createEditor(await emptyModel());
    editor.execute({ type: 'entity.create', id: 'e', name: 'E', physical: {} });
    const model = editor.model;
    // keys: [] put in by hand, as a loaded file may hold it.
    const withKeys = {
      ...model,
      entities: [
        {
          ...model.entities[0]!,
          data: { ...model.entities[0]!.data, keys: [] },
        },
      ],
    };
    const next = createEditor(withKeys);
    expect(
      next.execute({ type: 'attribute.create', entity: 'e', name: 'a' }).ok,
    ).toBe(true);
    const data = next.model.entities[0]!.data;
    expect(data.physical).toEqual({});
    expect(data.keys).toEqual([]);
    expect(data.attributes).toEqual([{ id: 'a', name: 'a' }]);
  });

  test('key.create then key.delete on an entity without keys leaves no keys', async () => {
    const editor = createEditor(await emptyModel());
    editor.execute({ type: 'entity.create', id: 'e', name: 'E' });
    editor.execute({
      type: 'attribute.create',
      entity: 'e',
      id: 'a',
      name: 'A',
    });
    const created = editor.execute({
      type: 'key.create',
      entity: 'e',
      kind: 'primary',
      attributes: ['a'],
    });
    expect(created.ok && created.id).toBe('pk');
    expect(editor.model.entities[0]!.data.keys).toEqual([
      { id: 'pk', kind: 'primary', attributes: ['a'] },
    ]);
    expect(
      editor.execute({ type: 'key.delete', entity: 'e', id: 'pk' }).ok,
    ).toBe(true);
    expect('keys' in editor.model.entities[0]!.data).toBe(false);
  });

  test('subjectArea.create with entities: [] or none has entities: []', async () => {
    for (const extra of [{ entities: [] }, {}]) {
      const editor = createEditor(await emptyModel());
      const result = editor.execute({
        type: 'subjectArea.create',
        name: 'A',
        ...extra,
      });
      expect(result.ok && result.id).toBe('a');
      expect(editor.model.subjectAreas[0]).toEqual({
        file: 'subject-areas/a.yaml',
        data: { id: 'a', name: 'A', entities: [] },
      });
    }
  });

  test('the create commands keep the fields they were given', async () => {
    // The example has the term and the area group the fields name.
    const editor = await exampleEditor();
    editor.execute({ type: 'entity.create', id: 'e', name: 'E' });
    const attribute = editor.execute({
      type: 'attribute.create',
      entity: 'e',
      name: '고객번호',
      definition: 'd',
      note: 'n',
      scope: 'logical',
      term: 'ord_no',
      dataType: { base: 'decimal', precision: 10, scale: 2 },
      nullable: false,
      default: 0,
      validValues: [{ value: 0, meaning: 'zero' }],
      physical: { name: 'CUST_NO', types: { pg: 'numeric(10,2)' } },
      nameSource: 'manual',
      ext: { a: 1 },
    });
    expect(attribute).toMatchObject({ ok: true, id: 'cust_no' });
    const key = editor.execute({
      type: 'key.create',
      entity: 'e',
      kind: 'alternate',
      name: '고객번호 키',
      attributes: ['cust_no'],
      scope: 'logical',
      physical: { name: 'AK_CUST' },
      ext: { b: 2 },
    });
    expect(key.ok && key.id).toBe('ak_cust');
    const area = editor.execute({
      type: 'subjectArea.create',
      name: '거래',
      id: 'trade',
      definition: 'd',
      group: 'trade',
      order: 2,
      entities: ['e'],
      ext: { c: 3 },
    });
    expect(area.ok && area.id).toBe('trade');
    const data = dataAt(editor.model, 'entities/e.yaml') as EntityData;
    expect(data.attributes).toEqual([
      {
        id: 'cust_no',
        name: '고객번호',
        definition: 'd',
        note: 'n',
        scope: 'logical',
        term: 'ord_no',
        type: { base: 'decimal', precision: 10, scale: 2 },
        nullable: false,
        default: 0,
        validValues: [{ value: 0, meaning: 'zero' }],
        physical: { name: 'CUST_NO', types: { pg: 'numeric(10,2)' } },
        nameSource: 'manual',
        ext: { a: 1 },
      },
    ]);
    expect(data.keys).toEqual([
      {
        id: 'ak_cust',
        kind: 'alternate',
        name: '고객번호 키',
        attributes: ['cust_no'],
        scope: 'logical',
        physical: { name: 'AK_CUST' },
        ext: { b: 2 },
      },
    ]);
    expect(editor.model.subjectAreas.at(-1)).toEqual({
      file: 'subject-areas/trade.yaml',
      data: {
        id: 'trade',
        name: '거래',
        definition: 'd',
        group: 'trade',
        order: 2,
        entities: ['e'],
        ext: { c: 3 },
      },
    });
  });

  test('key.update and subjectArea.update set and unset their fields', async () => {
    const editor = await exampleEditor();
    let data = changed(editor, {
      type: 'key.update',
      entity: 'order',
      id: 'ie_ord_dtm',
      set: { kind: 'alternate', attributes: ['ord_dtm'], scope: 'physical' },
      unset: ['physical.name'],
    });
    expect(data.keys![1]).toEqual({
      id: 'ie_ord_dtm',
      kind: 'alternate',
      attributes: ['ord_dtm'],
      scope: 'physical',
    });
    editor.execute({
      type: 'subjectArea.update',
      id: 'sales',
      set: { definition: 'd', order: 1, ext: { x: 1 } },
      unset: ['group'],
    });
    expect(dataAt(editor.model, 'subject-areas/sales.yaml')).toEqual({
      id: 'sales',
      name: '주문',
      definition: 'd',
      order: 1,
      entities: ['address', 'customer', 'order', 'order_item', 'product'],
      ext: { x: 1 },
    });
    data = order(editor);
    expect(data.keys!.length).toBe(2);
  });

  test('unset removes a key; set and unset of one key leave the set value', async () => {
    const editor = await exampleEditor();
    expect(order(editor).definition).toBeDefined();
    const without = changed(editor, {
      type: 'entity.update',
      id: 'order',
      unset: ['definition'],
    });
    expect('definition' in without).toBe(false);
    const both = changed(editor, {
      type: 'entity.update',
      id: 'order',
      unset: ['note'],
      set: { note: 'n' },
    });
    expect(both.note).toBe('n');
  });

  test('unsetting the last key of physical removes physical', async () => {
    const editor = await exampleEditor();
    expect(order(editor).physical).toEqual({ name: 'ORDERS' });
    const data = changed(editor, {
      type: 'entity.update',
      id: 'order',
      unset: ['physical.name'],
    });
    expect('physical' in data).toBe(false);
  });

  test('set.physical goes key by key; set.ext replaces ext whole', async () => {
    const editor = createEditor(
      handModel({
        entities: [
          entityItem('a', {
            physical: { name: 'A' },
            ext: { x: 1, y: { z: 2 } },
          }),
        ],
      }),
    );
    editor.execute({
      type: 'entity.update',
      id: 'a',
      set: { physical: { schema: 's' }, ext: { y: 3 } },
    });
    const data = editor.model.entities[0]!.data;
    expect(data.physical).toEqual({ name: 'A', schema: 's' });
    expect(data.ext).toEqual({ y: 3 });
    // unset of all of physical, and of one of two keys.
    editor.execute({
      type: 'entity.update',
      id: 'a',
      unset: ['physical.schema'],
    });
    expect(editor.model.entities[0]!.data.physical).toEqual({ name: 'A' });
    editor.execute({ type: 'entity.update', id: 'a', unset: ['physical'] });
    expect('physical' in editor.model.entities[0]!.data).toBe(false);
  });

  test('an entity.update that changes nothing keeps the model and the history', async () => {
    const editor = createEditor(
      handModel({
        entities: [
          entityItem('a', { name: 'A', physical: {}, ext: { x: 1, y: 2 } }),
        ],
      }),
    );
    editor.execute({ type: 'entity.create', id: 'b', name: 'B' });
    const model = editor.model;
    const cases: unknown[] = [
      { type: 'entity.update', id: 'a', set: {} },
      { type: 'entity.update', id: 'a' },
      { type: 'entity.update', id: 'a', set: {}, unset: [] },
      { type: 'entity.update', id: 'a', set: { name: 'A' } },
      { type: 'entity.update', id: 'a', set: { scope: 'both' } },
      { type: 'entity.update', id: 'a', set: { physical: {} } },
      { type: 'entity.update', id: 'a', unset: ['definition'] },
      { type: 'entity.update', id: 'a', set: { ext: { x: 1, y: 2 } } },
    ];
    for (const command of cases) {
      const result = editor.execute(command);
      expect(result).toEqual({ ok: true, model, issues: [] });
      expect(succeeded(result).model).toBe(model);
      expect(editor.model).toBe(model);
      expect(editor.canUndo).toBe(true);
      expect(editor.canRedo).toBe(false);
    }
    // One step of history: the create of `b`.
    editor.undo();
    expect(editor.canUndo).toBe(false);
    // physical: {} that no command touched stays.
    expect(editor.model.entities[0]!.data.physical).toEqual({});
  });

  test('an ext with only its key order changed is a change', () => {
    const editor = createEditor(
      handModel({ entities: [entityItem('a', { ext: { x: 1, y: 2 } })] }),
    );
    const model = editor.model;
    const result = editor.execute({
      type: 'entity.update',
      id: 'a',
      set: { ext: { y: 2, x: 1 } },
    });
    expect(result.ok).toBe(true);
    expect(succeeded(result).model).not.toBe(model);
    expect(Object.keys(editor.model.entities[0]!.data.ext!)).toEqual([
      'y',
      'x',
    ]);
  });

  test('entity.create puts the new id in its subject area once', () => {
    const editor = createEditor(
      handModel({ subjectAreas: [areaItem('s', ['x'])] }),
    );
    const area = editor.model.subjectAreas[0]!;
    editor.execute({
      type: 'entity.create',
      id: 'n',
      name: 'N',
      subjectArea: 's',
    });
    expect(editor.model.subjectAreas[0]!.data.entities).toEqual(['x', 'n']);
    expect(area.data.entities).toEqual(['x']);
    // Already listed: not added again.
    editor.execute({
      type: 'entity.create',
      id: 'x',
      name: 'X',
      subjectArea: 's',
    });
    expect(editor.model.subjectAreas[0]!.data.entities).toEqual(['x', 'n']);
  });

  test('entity.create keeps the fields it was given, in the entity', async () => {
    const editor = createEditor(await emptyModel());
    const result = editor.execute({
      type: 'entity.create',
      name: '고객',
      definition: 'd',
      note: 'n',
      scope: 'logical',
      nameSource: 'manual',
      physical: { name: 'CUSTOMER_V2', schema: 'main' },
      ext: { a: [1] },
    });
    expect(result.ok && result.id).toBe('customer_v2');
    expect(editor.model.entities[0]).toEqual({
      file: 'entities/customer_v2.yaml',
      data: {
        id: 'customer_v2',
        name: '고객',
        definition: 'd',
        note: 'n',
        scope: 'logical',
        nameSource: 'manual',
        physical: { name: 'CUSTOMER_V2', schema: 'main' },
        attributes: [],
        ext: { a: [1] },
      },
    });
  });

  test('a model whose items are frozen all the way down runs the samples', async () => {
    const model = await exampleModel();
    const stack: unknown[] = [model];
    while (stack.length > 0) {
      const value = stack.pop();
      if (typeof value === 'object' && value !== null) {
        Object.freeze(value);
        for (const child of Object.values(value)) stack.push(child);
      }
    }
    const editor = createEditor(model);
    for (const sample of SAMPLE_COMMANDS) {
      if (sample.start !== 'example') continue;
      expect(editor.execute(sample.command).ok).toBe(true);
      // Back to the frozen model, so each sample starts there.
      expect(editor.undo().ok).toBe(true);
      expect(editor.model).toBe(model);
    }
  });
});
