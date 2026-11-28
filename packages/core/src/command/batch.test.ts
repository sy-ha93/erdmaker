import { describe, expect, test, vi } from 'vitest';
import { createMemoryFileSystem } from '../fs/memory.js';
import { loadModel } from '../model/load.js';
import { serializeItem } from '../model/serialize-item.js';
import { validateModel } from '../validate/index.js';
import {
  areaItem,
  cachedExampleFiles,
  deepFreeze,
  emptyFiles,
  emptyModel,
  entityItem,
  exampleModel,
  handModel,
  snapshotOf,
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
 * The cells the working state reported since the spies were cleared, by
 * kind. A growth assertion over these says nothing when nothing reports, so
 * each workload first asserts a lower bound per kind (final review), as
 * cascade-work.test.ts does.
 */
const workByKind = () => {
  const work = { copy: 0, scan: 0, 'index-build': 0 };
  for (const [kind, entries] of vi.mocked(noteWork).mock.calls) {
    work[kind] += entries;
  }
  return work;
};

/**
 * Set from the green run (plan decision 9, section 7): T(250) = 5501,
 * T(500) = 6001, T(1000) = 7001, two cells per create.
 */
const TOLERANCE = 2;
const C = 4;

/**
 * The mixed batch (entity, attribute and key creates with generated ids,
 * updates and deletes), set from its green run: T(250) = 5401,
 * T(500) = 5801, T(1000) = 6601, 1.6 cells per sub-command.
 */
const MIXED_TOLERANCE = 2;
const MIXED_C = 4;

/**
 * The member and subject area batch (one of each of the 11 kinds per
 * group), set from its green run: T(220) = 11114, T(440) = 12214,
 * T(880) = 14414, 5 cells per sub-command.
 */
const MEMBER_TOLERANCE = 2;
const MEMBER_C = 6;

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

  test('on a deep-frozen model, a batch changing one entity several ways leaves the start model as it was', () => {
    const model = deepFreeze(
      handModel({
        entities: [
          entityItem('x', {
            physical: { name: 'X' },
            attributes: [{ id: 'a', name: 'A' }],
          }),
        ],
        subjectAreas: [areaItem('s', ['x'])],
        layouts: [
          {
            file: 'layouts/s.json',
            data: {
              formatVersion: '0.1',
              subjectArea: 's',
              nodes: { x: { x: 0, y: 0 } },
            },
          },
        ],
      }),
    );
    const before = snapshotOf(model);
    const editor = createEditor(model);
    const result = editor.execute(
      batch(
        { type: 'entity.update', id: 'x', set: { note: 'n' } },
        { type: 'entity.delete', id: 'x' },
        { type: 'entity.create', id: 'y', name: 'Y', subjectArea: 's' },
      ),
    );
    expect(result.ok).toBe(true);
    expect(editor.model.subjectAreas[0]!.data.entities).toEqual(['y']);
    expect(snapshotOf(model)).toEqual(before);
    expect(succeeded(editor.undo()).model).toBe(model);
  });

  test.each([
    [
      'entity.update X, attribute.create X',
      [
        { type: 'entity.update', id: 'order', set: { note: 'n' } },
        { type: 'attribute.create', entity: 'order', id: 'memo', name: 'M' },
      ],
    ],
    [
      'attribute.update X.a, key.create X',
      [
        {
          type: 'attribute.update',
          entity: 'order',
          id: 'ord_dtm',
          set: { definition: 'd', physical: { name: 'ORD_AT' } },
        },
        {
          type: 'key.create',
          entity: 'order',
          kind: 'alternate',
          attributes: ['ord_dtm'],
        },
        {
          type: 'key.update',
          entity: 'order',
          id: 'ie_ord_dtm',
          set: { attributes: ['ord_dtm'] },
          unset: ['physical.name'],
        },
        { type: 'attribute.delete', entity: 'order', id: 'ord_dtm' },
      ],
    ],
    [
      'subjectArea.update S, subjectArea.addEntities S',
      [
        { type: 'subjectArea.update', id: 'sales', set: { definition: 'd' } },
        { type: 'subjectArea.addEntities', id: 'sales', entities: ['tag'] },
        {
          type: 'subjectArea.removeEntities',
          id: 'sales',
          entities: ['order'],
        },
      ],
    ],
    [
      'entity.update, entity.delete, entity.create with subjectArea',
      [
        { type: 'entity.create', id: 'memo', name: 'M' },
        { type: 'entity.update', id: 'memo', set: { note: 'n' } },
        { type: 'entity.delete', id: 'memo' },
        { type: 'entity.create', id: 'memo2', name: 'M', subjectArea: 'sales' },
        { type: 'subjectArea.delete', id: 'catalog' },
      ],
    ],
  ])(
    'on the deep-frozen example, %s: the start model stays as it was and undo gives it back',
    async (_name, commands) => {
      const model = deepFreeze(await exampleModel());
      const before = snapshotOf(model);
      const editor = createEditor(model);
      const result = editor.execute(batch(...commands));
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(editor.model).not.toBe(model);
      expect(snapshotOf(model)).toEqual(before);
      expect(succeeded(editor.undo()).model).toBe(model);
      expect(succeeded(editor.redo()).model).toBe(result.ok && result.model);
    },
  );

  test('lookups after an insert, a delete and a move in one batch find the moved attributes', async () => {
    const editor = createEditor(await exampleModel());
    const note = (id: string) => ({
      type: 'attribute.update',
      entity: 'order',
      id,
      set: { note: id },
    });
    const result = editor.execute(
      batch(
        note('ord_dtm'),
        {
          type: 'attribute.create',
          entity: 'order',
          id: 'memo',
          name: 'M',
          before: 'cust_no',
        },
        note('ord_dtm'),
        note('created_at'),
        { type: 'attribute.delete', entity: 'order', id: 'total_amt' },
        note('created_at'),
        {
          type: 'attribute.move',
          entity: 'order',
          id: 'created_at',
          before: 'cust_no',
        },
        note('bill_addr_no'),
        note('created_at'),
      ),
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const order = editor.model.entities.find(
      (item) => item.data.id === 'order',
    )!.data;
    expect(order.attributes.map((a) => [a.id, a.note])).toEqual([
      ['ord_no', undefined],
      ['memo', undefined],
      ['created_at', 'created_at'],
      ['cust_no', undefined],
      ['ship_addr_no', undefined],
      ['bill_addr_no', 'bill_addr_no'],
      ['ord_dtm', 'ord_dtm'],
    ]);
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
    // The recreated item is the original object, at the end of its list.
    expect(editor.model.entities.at(-1)).toBe(memo);
    expect(saved.entities.at(-1)).not.toBe(memo);
    vi.mocked(serializeItem).mockClear();
    const written = await writeChanges(fs, saved, editor.model);
    expect(written).toEqual({ written: ['entities/order.yaml'], removed: [] });
    expect(vi.mocked(serializeItem).mock.calls.map(([file]) => file)).toEqual([
      'entities/order.yaml',
    ]);
  });

  test('a recreated item keeps its place when its list ends with only start items', () => {
    const a = entityItem('a', { name: 'A' });
    const b = entityItem('b', { name: 'B' });
    const start = handModel({ entities: [a, b] });
    const recreate = [
      { type: 'entity.delete', id: 'a' },
      { type: 'entity.create', id: 'a', name: 'A' },
    ];
    // Another list changes: the entities are the start list itself.
    const kept = createEditor(start);
    const area = succeeded(
      kept.execute(
        batch(...recreate, { type: 'subjectArea.create', name: 'S' }),
      ),
    ).model;
    expect(area).not.toBe(start);
    expect(area.entities).toBe(start.entities);
    expect(area.entities).toEqual([a, b]);
    // Another entity changes: the recreated item is at the end.
    const moved = createEditor(start);
    const updated = succeeded(
      moved.execute(
        batch(...recreate, {
          type: 'entity.update',
          id: 'b',
          set: { note: 'n' },
        }),
      ),
    ).model;
    expect(updated.entities).toHaveLength(2);
    expect(updated.entities[0]!.data.id).toBe('b');
    expect(updated.entities[1]).toBe(a);
  });

  test('the spec form: the batch also changes the definition of order.ord_dtm; only order.yaml is serialized and written', async () => {
    const fs = createMemoryFileSystem(cachedExampleFiles());
    const loaded = (await loadModel(fs, '')).model;
    const setup = createEditor(loaded);
    const memoCommand = {
      type: 'entity.create',
      id: 'memo',
      name: '메모',
      definition: '관계 없는 엔터티.',
    };
    setup.execute(memoCommand);
    await writeChanges(fs, loaded, setup.model);
    const saved = (await loadModel(fs, '')).model;
    const memo = saved.entities.find((item) => item.data.id === 'memo')!;
    const editor = createEditor(saved);
    const result = editor.execute(
      batch({ type: 'entity.delete', id: 'memo' }, memoCommand, {
        type: 'attribute.update',
        entity: 'order',
        id: 'ord_dtm',
        set: { definition: '주문한 시각.' },
      }),
    );
    expect(result.ok).toBe(true);
    expect(editor.model.entities).toContain(memo);
    vi.mocked(serializeItem).mockClear();
    expect(await writeChanges(fs, saved, editor.model)).toEqual({
      written: ['entities/order.yaml'],
      removed: [],
    });
    expect(vi.mocked(serializeItem).mock.calls.map(([file]) => file)).toEqual([
      'entities/order.yaml',
    ]);
  });

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

  test('an entity, its attribute and a key in one batch: ids, data, one validation, one undo', async () => {
    const editor = createEditor(await emptyModel());
    const start = editor.model;
    clearSpies();
    const result = editor.execute(
      batch(
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
      ),
    );
    expect(result).toMatchObject({ ok: true, ids: ['a', 'a_no', 'pk'] });
    expect(validateModel).toHaveBeenCalledTimes(1);
    expect(editor.model.entities[0]!.data).toEqual({
      id: 'a',
      name: 'A',
      attributes: [
        {
          id: 'a_no',
          name: 'A 번호',
          type: { base: 'integer' },
          nullable: false,
        },
      ],
      keys: [{ id: 'pk', kind: 'primary', attributes: ['a_no'] }],
    });
    expect(succeeded(editor.undo()).model).toBe(start);
  });

  test('deleting the pk of order and making a primary key of the same attribute again succeeds', async () => {
    const editor = createEditor(await exampleModel());
    const remove = { type: 'key.delete', entity: 'order', id: 'pk' };
    expect(editor.execute(remove)).toMatchObject({
      ok: false,
      code: 'validation',
    });
    const result = editor.execute(
      batch(remove, {
        type: 'key.create',
        entity: 'order',
        kind: 'primary',
        id: 'pk',
        attributes: ['ord_no'],
      }),
    );
    expect(result).toMatchObject({ ok: true, ids: [null, 'pk'] });
    expect(editor.issues).toEqual([]);
  });

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
      // The entity list is copied and indexed by id once, and each create
      // looks at it.
      const done = workByKind();
      expect(done.copy).toBeGreaterThanOrEqual(1000);
      expect(done['index-build']).toBeGreaterThanOrEqual(1000);
      expect(done.scan).toBeGreaterThanOrEqual(n);
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

  test('the work of a mixed batch grows linearly with its size', () => {
    const entities = [];
    for (let i = 0; i < 1000; i += 1) entities.push(entityItem(`e${i}`));
    const model = handModel({ entities });
    const work: number[] = [];
    for (const n of [250, 500, 1000] as const) {
      const editor = createEditor(model);
      clearSpies();
      const commands = [];
      for (let g = 0; g < n / 5; g += 1) {
        commands.push(
          { type: 'entity.create', name: `New ${g}` },
          { type: 'attribute.create', entity: `new_${g}`, name: 'A' },
          {
            type: 'key.create',
            entity: `new_${g}`,
            kind: 'primary',
            attributes: ['a'],
          },
          { type: 'entity.update', id: `e${g}`, set: { note: 'n' } },
          { type: 'entity.delete', id: `e${999 - g}` },
        );
      }
      const result = editor.execute(batch(...commands));
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(editor.model.entities.length).toBe(1000);
      expect(validateModel).toHaveBeenCalledTimes(1);
      // The entity list is copied and indexed by id once, and each of the
      // n / 5 deletes scans for its entity.
      const done = workByKind();
      expect(done.copy).toBeGreaterThanOrEqual(1000);
      expect(done['index-build']).toBeGreaterThanOrEqual(1000);
      expect(done.scan).toBeGreaterThanOrEqual(n / 5);
      let cells = 0;
      for (const [, entries] of vi.mocked(noteWork).mock.calls)
        cells += entries;
      work.push(
        cells +
          vi.mocked(serializeItem).mock.calls.length +
          vi.mocked(validateModel).mock.calls.length,
      );
    }
    const [t250, t500, t1000] = work as [number, number, number];
    const d250 = t500 - t250;
    const d500 = t1000 - t500;
    expect(Math.abs(d500 - 2 * d250)).toBeLessThanOrEqual(MIXED_TOLERANCE);
    expect(d500).toBeLessThanOrEqual(500 * MIXED_C);
  });

  test('the work of a batch of member and subject area commands grows linearly with its size', () => {
    // 1000 entities with three attributes and three keys each; the area
    // `grow` starts empty and gains one entity per group, `all` lists
    // every entity, and `z<i>` lists `e<i>`.
    const attribute = (id: string) => ({
      id,
      name: id.toUpperCase(),
      type: { base: 'string' as const, length: 10 },
    });
    const entities = [];
    const areas = [areaItem('grow'), areaItem('all')];
    for (let i = 0; i < 1000; i += 1) {
      entities.push(
        entityItem(`e${i}`, {
          attributes: [attribute('a0'), attribute('a1'), attribute('a2')],
          keys: [
            { id: 'pk', kind: 'primary', attributes: ['a0'] },
            { id: 'ak', kind: 'alternate', attributes: ['a2'] },
            { id: 'ie', kind: 'inversion', attributes: ['a1', 'a2'] },
          ],
        }),
      );
      areas[1]!.data.entities.push(`e${i}`);
      areas.push(areaItem(`z${i}`, [`e${i}`]));
    }
    const model = handModel({ entities, subjectAreas: areas });
    expect(validateModel(model)).toEqual([]);

    // One group: one command of each of the 11 kinds, on `e<g>`. The batch
    // holds at most 1000, so the sizes are 20, 40 and 80 groups.
    const group = (g: number) => {
      const e = `e${g}`;
      return [
        {
          type: 'attribute.update',
          entity: e,
          id: 'a0',
          set: { definition: 'd' },
        },
        { type: 'attribute.move', entity: e, id: 'a2', before: 'a0' },
        { type: 'attribute.delete', entity: e, id: 'a1' },
        { type: 'key.update', entity: e, id: 'ak', set: { name: 'AK' } },
        { type: 'key.move', entity: e, id: 'ie', before: 'pk' },
        { type: 'key.delete', entity: e, id: 'ie' },
        {
          type: 'subjectArea.create',
          id: `n${g}`,
          name: `N${g}`,
          entities: [e],
        },
        { type: 'subjectArea.update', id: `n${g}`, set: { definition: 'd' } },
        { type: 'subjectArea.addEntities', id: 'grow', entities: [e] },
        { type: 'subjectArea.removeEntities', id: `z${g}`, entities: [e] },
        { type: 'subjectArea.delete', id: `z${999 - g}` },
      ];
    };
    const sizes = [220, 440, 880] as const;
    const work: number[] = [];
    const listBuilds: number[] = [];
    const indexBuilds: number[] = [];
    for (const n of sizes) {
      const editor = createEditor(model);
      clearSpies();
      const commands = [];
      for (let g = 0; g < n / 11; g += 1) commands.push(...group(g));
      expect(commands).toHaveLength(n);
      const result = editor.execute(batch(...commands));
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(validateModel).toHaveBeenCalledTimes(1);
      const end = editor.model;
      expect(end.subjectAreas).toHaveLength(1002);
      expect(
        end.subjectAreas.find((item) => item.data.id === 'grow')!.data.entities,
      ).toHaveLength(n / 11);
      expect(end.entities[0]!.data).toEqual({
        id: 'e0',
        name: 'e0',
        attributes: [attribute('a2'), { ...attribute('a0'), definition: 'd' }],
        keys: [
          { id: 'pk', kind: 'primary', attributes: ['a0'] },
          { id: 'ak', name: 'AK', kind: 'alternate', attributes: ['a2'] },
        ],
      });

      // The entity and subject area lists are each copied and indexed by
      // id once, and each of the n / 11 groups scans.
      const done = workByKind();
      expect(done.copy).toBeGreaterThanOrEqual(1000);
      expect(done['index-build']).toBeGreaterThanOrEqual(2000);
      expect(done.scan).toBeGreaterThanOrEqual(n / 11);
      const calls = vi.mocked(noteWork).mock.calls;
      let cells = 0;
      for (const [, entries] of calls) cells += entries;
      work.push(
        cells +
          vi.mocked(serializeItem).mock.calls.length +
          vi.mocked(validateModel).mock.calls.length,
      );
      const builds = calls.filter(([kind]) => kind === 'index-build');
      indexBuilds.push(builds.length);
      // The builds over a whole list (1000 entities or more items).
      listBuilds.push(builds.filter(([, entries]) => entries >= 1000).length);
    }
    const [t220, t440, t880] = work as [number, number, number];
    const d220 = t440 - t220;
    const d440 = t880 - t440;
    expect(listBuilds[1]).toBe(listBuilds[0]);
    expect(listBuilds[2]).toBe(listBuilds[0]);
    // Each group builds the same member and area indexes.
    expect(indexBuilds[2]! - indexBuilds[1]!).toBe(
      2 * (indexBuilds[1]! - indexBuilds[0]!),
    );
    expect(Math.abs(d440 - 2 * d220)).toBeLessThanOrEqual(MEMBER_TOLERANCE);
    expect(d440).toBeLessThanOrEqual(440 * MEMBER_C);
  });
});
