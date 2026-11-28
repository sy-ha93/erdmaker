import { describe, expect, test, vi } from 'vitest';
import { createMemoryFileSystem } from '../fs/memory.js';
import { loadModel } from '../model/load.js';
import { serializeItem } from '../model/serialize-item.js';
import { validateModel } from '../validate/index.js';
import {
  cachedExampleFiles,
  emptyFiles,
  emptyModel,
  entityItem,
  exampleModel,
  handModel,
  succeeded,
} from '../testing/editing.js';
import { createEditor } from './editor.js';
import { noteWork } from './work.js';
import { writeChanges } from './write-changes.js';

vi.mock('../validate/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../validate/index.js')>();
  return { ...actual, validateModel: vi.fn(actual.validateModel) };
});
vi.mock('../model/serialize-item.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../model/serialize-item.js')>();
  return { ...actual, serializeItem: vi.fn(actual.serializeItem) };
});
vi.mock('./work.js', () => ({ noteWork: vi.fn() }));

const batch = (...commands: unknown[]) => ({ type: 'batch', commands });

const clearSpies = () => {
  vi.mocked(validateModel).mockClear();
  vi.mocked(serializeItem).mockClear();
  vi.mocked(noteWork).mockClear();
};

/**
 * Set from the green run (plan decision 9, section 7): T(250) = 5501,
 * T(500) = 6001, T(1000) = 7001, two cells per create.
 */
const TOLERANCE = 2;
const C = 4;

describe('묶음', () => {
  test('the failures come in order: sub-command lookups, shapes, the envelope', async () => {
    const editor = createEditor(await emptyModel());
    const model = editor.model;
    const ok = { type: 'entity.create', id: 'a', name: 'A' };
    const missing = {
      type: 'entity.update',
      id: 'missing',
      set: { note: 'n' },
    };
    const misshapen = { type: 'entity.create', id: 'b' };

    clearSpies();
    expect(editor.execute(batch(ok, missing, misshapen))).toEqual({
      ok: false,
      code: 'not-found',
      message: 'commands[1]: entity "missing" does not exist',
      issues: [],
      index: 1,
    });
    expect(editor.model).toBe(model);
    expect(validateModel).toHaveBeenCalledTimes(0);

    clearSpies();
    expect(editor.execute(batch(ok, misshapen, missing))).toEqual({
      ok: false,
      code: 'invalid-command',
      message: "commands[1]: / must have required property 'name'",
      issues: [],
      index: 1,
    });
    expect(editor.model).toBe(model);
    expect(validateModel).toHaveBeenCalledTimes(0);

    clearSpies();
    const envelope = { ...batch(ok, misshapen, missing), extra: 1 };
    expect(editor.execute(envelope)).toEqual({
      ok: false,
      code: 'invalid-command',
      message: '/ must NOT have additional properties',
      issues: [],
    });
    expect(editor.model).toBe(model);
    expect(validateModel).toHaveBeenCalledTimes(0);
    expect(editor.canUndo).toBe(false);
  });

  test('a batch cannot hold a batch, before the inner one is checked', async () => {
    const editor = createEditor(await emptyModel());
    const model = editor.model;
    const ok = { type: 'entity.create', id: 'a', name: 'A' };
    for (const inner of [
      batch(ok),
      { type: 'batch' },
      { type: 'batch', x: 1 },
    ]) {
      expect(editor.execute(batch(ok, inner))).toEqual({
        ok: false,
        code: 'invalid-command',
        message: 'commands[1]: a batch cannot hold a batch',
        issues: [],
        index: 1,
      });
      expect(editor.model).toBe(model);
    }
    // A sub-command without a type is checked as any command.
    expect(editor.execute(batch({ name: 'x' }))).toEqual({
      ok: false,
      code: 'invalid-command',
      message: 'commands[0]: command type must be a string',
      issues: [],
      index: 0,
    });
  });

  test('a sub-command message is prefixed before the one-line pass', async () => {
    const editor = createEditor(await emptyModel());
    expect(editor.execute(batch({ type: '\u2028' }))).toEqual({
      ok: false,
      code: 'invalid-command',
      message: 'commands[0]: unknown command type "\\u{2028}"',
      issues: [],
      index: 0,
    });
  });

  test('an end with more errors is a validation refusal without an index', async () => {
    const editor = createEditor(await exampleModel());
    const model = editor.model;
    clearSpies();
    const result = editor.execute(
      batch(
        { type: 'entity.create', id: 'x', name: 'X' },
        { type: 'entity.delete', id: 'tag' },
      ),
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe('validation');
    expect('index' in result).toBe(false);
    expect(validateModel).toHaveBeenCalledTimes(1);
    expect(editor.model).toBe(model);
  });

  test('a middle state with errors is not looked at', async () => {
    const editor = createEditor(await emptyModel());
    const result = editor.execute(
      batch(
        { type: 'entity.create', id: 'a', name: 'A', physical: { name: 'T' } },
        { type: 'entity.create', id: 'b', name: 'B', physical: { name: 'T' } },
        { type: 'entity.update', id: 'b', set: { physical: { name: 'U' } } },
      ),
    );
    expect(result.ok).toBe(true);
    expect(editor.issues).toEqual([]);
  });

  test('ids hold the id of each create and null for the others; one validation; one undo step', async () => {
    const start = await emptyModel();
    const editor = createEditor(start);
    clearSpies();
    const result = editor.execute(
      batch(
        { type: 'entity.create', name: 'Order Item' },
        { type: 'entity.create', id: 'b', name: 'B' },
        { type: 'entity.update', id: 'b', set: { note: 'n' } },
        { type: 'entity.create', name: 'Order Item' },
      ),
    );
    expect(result).toEqual({
      ok: true,
      model: editor.model,
      issues: [],
      ids: ['order_item', 'b', null, 'order_item_2'],
    });
    expect('id' in result).toBe(false);
    expect(validateModel).toHaveBeenCalledTimes(1);
    expect(editor.model.entities.map((item) => item.data)).toEqual([
      { id: 'order_item', name: 'Order Item', attributes: [] },
      { id: 'b', name: 'B', note: 'n', attributes: [] },
      { id: 'order_item_2', name: 'Order Item', attributes: [] },
    ]);
    expect(succeeded(editor.undo()).model).toBe(start);
    expect(editor.canUndo).toBe(false);
  });

  test('a create and a delete of it: ok, ids, the same model, no history, no validation', async () => {
    const editor = createEditor(await exampleModel());
    const model = editor.model;
    clearSpies();
    const result = editor.execute(
      batch(
        { type: 'entity.create', name: '배송' },
        { type: 'entity.delete', id: 'baesong' },
      ),
    );
    expect(result).toEqual({
      ok: true,
      model,
      issues: editor.issues,
      ids: ['baesong', null],
    });
    expect(succeeded(result).model).toBe(model);
    expect(editor.model).toBe(model);
    expect(editor.canUndo).toBe(false);
    expect(validateModel).toHaveBeenCalledTimes(0);
  });

  test('deleting an entity and making it again with the same id and values keeps its item object', async () => {
    const files = cachedExampleFiles();
    const fs = createMemoryFileSystem(files);
    const loaded = (await loadModel(fs, '')).model;
    // An entity outside every relationship, saved first.
    const setup = createEditor(loaded);
    setup.execute({
      type: 'entity.create',
      id: 'memo',
      name: '메모',
      definition: '관계 없는 엔터티.',
      physical: { name: 'MEMO' },
    });
    await writeChanges(fs, loaded, setup.model);
    const saved = (await loadModel(fs, '')).model;
    const editor = createEditor(saved);
    const memo = saved.entities.find((item) => item.data.id === 'memo')!;
    const result = editor.execute(
      batch(
        { type: 'entity.delete', id: 'memo' },
        {
          type: 'entity.create',
          id: 'memo',
          name: '메모',
          definition: '관계 없는 엔터티.',
          physical: { name: 'MEMO' },
        },
        { type: 'entity.update', id: 'order', set: { note: '메모' } },
      ),
    );
    expect(result.ok).toBe(true);
    expect(editor.model.entities).toContain(memo);
    vi.mocked(serializeItem).mockClear();
    const written = await writeChanges(fs, saved, editor.model);
    expect(written).toEqual({ written: ['entities/order.yaml'], removed: [] });
    expect(vi.mocked(serializeItem).mock.calls.map(([file]) => file)).toEqual([
      'entities/order.yaml',
    ]);
  });

  test.todo(
    'the spec form of the line above: the batch changes order.ord_dtm with attribute.update (phase 6)',
  );

  test('a batch that only deletes changes the model; saving removes the file and undo brings it back', async () => {
    const fs = createMemoryFileSystem(emptyFiles());
    const empty = (await loadModel(fs, '')).model;
    const setup = createEditor(empty);
    setup.execute({ type: 'entity.create', name: 'a' });
    setup.execute({ type: 'entity.create', name: 'b' });
    await writeChanges(fs, empty, setup.model);
    const bytes = await fs.readText('entities/b.yaml');
    const saved = (await loadModel(fs, '')).model;
    const editor = createEditor(saved);

    const result = editor.execute(batch({ type: 'entity.delete', id: 'b' }));
    expect(result.ok).toBe(true);
    expect(succeeded(result).model).not.toBe(saved);
    expect(editor.canUndo).toBe(true);
    expect(await writeChanges(fs, saved, editor.model)).toEqual({
      written: [],
      removed: ['entities/b.yaml'],
    });
    const deleted = editor.model;
    editor.undo();
    expect(await writeChanges(fs, deleted, editor.model)).toEqual({
      written: ['entities/b.yaml'],
      removed: [],
    });
    expect(await fs.readText('entities/b.yaml')).toBe(bytes);
  });

  test.todo(
    'an entity, its attribute and a key in one batch: ids, data, one validation, one undo (phase 6)',
  );
  test.todo(
    'deleting the pk of order and making a primary key of the same attribute again succeeds (phase 6)',
  );

  test('the work of a batch of creates grows linearly with its size', () => {
    const entities = [];
    for (let i = 0; i < 1000; i += 1) entities.push(entityItem(`e${i}`));
    const model = handModel({ entities });
    expect(validateModel(model)).toEqual([]);

    const sizes = [250, 500, 1000] as const;
    const work: number[] = [];
    const indexBuilds: number[] = [];
    for (const n of sizes) {
      const editor = createEditor(model);
      clearSpies();
      const commands = [];
      for (let i = 0; i < n; i += 1) {
        commands.push({ type: 'entity.create', id: `n${i}`, name: `N${i}` });
      }
      const result = editor.execute(batch(...commands));
      expect(result.ok).toBe(true);
      expect(editor.model.entities.length).toBe(1000 + n);

      const calls = vi.mocked(noteWork).mock.calls;
      let cells = 0;
      for (const [, entries] of calls) cells += entries;
      expect(validateModel).toHaveBeenCalledTimes(1);
      work.push(
        cells +
          vi.mocked(serializeItem).mock.calls.length +
          vi.mocked(validateModel).mock.calls.length,
      );
      indexBuilds.push(calls.filter(([kind]) => kind === 'index-build').length);
    }
    const [t250, t500, t1000] = work as [number, number, number];
    const d250 = t500 - t250;
    const d500 = t1000 - t500;
    expect(indexBuilds[1]).toBe(indexBuilds[0]);
    expect(indexBuilds[2]).toBe(indexBuilds[0]);
    expect(Math.abs(d500 - 2 * d250)).toBeLessThanOrEqual(TOLERANCE);
    expect(d500).toBeLessThanOrEqual(500 * C);
  });
});
