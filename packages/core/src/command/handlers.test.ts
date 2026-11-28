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

  test.todo('the samples of the other 13 kinds (phase 6)');

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

  test('a model whose items are frozen all the way down runs the entity samples', async () => {
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
      if (
        sample.start !== 'example' ||
        !sample.command.type.startsWith('entity.')
      )
        continue;
      expect(editor.execute(sample.command).ok).toBe(true);
    }
    expect(editor.execute({ type: 'entity.delete', id: 'baesong' }).ok).toBe(
      true,
    );
  });
});
