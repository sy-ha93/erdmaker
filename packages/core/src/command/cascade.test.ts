import { describe, expect, test } from 'vitest';
import { createMemoryFileSystem } from '../fs/memory.js';
import { loadModel } from '../model/load.js';
import type { EntityData, LayoutData } from '../model/types.js';
import { dataAt } from '../testing/commands.js';
import {
  areaItem,
  cachedExampleFiles,
  emptyModel,
  entityItem,
  exampleModel,
  handModel,
  succeeded,
} from '../testing/editing.js';
import { createEditor } from './editor.js';
import type { Editor } from './types.js';
import { writeChanges } from './write-changes.js';

const refused = (code: string, message: string) => ({
  ok: false,
  code,
  message,
  issues: [],
});

const orderOf = (editor: Editor) =>
  dataAt(editor.model, 'entities/order.yaml') as EntityData;

describe('연쇄와 대상', () => {
  test('deleting an entity takes it out of its subject areas and layouts', async () => {
    const fs = createMemoryFileSystem(cachedExampleFiles());
    const loaded = (await loadModel(fs, '')).model;
    const setup = createEditor(loaded);
    const created = setup.execute({
      type: 'entity.create',
      name: '배송',
      subjectArea: 'catalog',
    });
    expect(created.ok && created.id).toBe('baesong');
    await writeChanges(fs, loaded, setup.model);
    const layout = JSON.parse(
      await fs.readText('layouts/catalog.json'),
    ) as LayoutData;
    layout.nodes.baesong = { x: 1400, y: 40 };
    await fs.writeText(
      'layouts/catalog.json',
      `${JSON.stringify(layout, null, 2)}\n`,
    );
    const saved = (await loadModel(fs, '')).model;

    const editor = createEditor(saved);
    expect(editor.issues).toEqual([]);
    const result = editor.execute({ type: 'entity.delete', id: 'baesong' });
    expect(result.ok).toBe(true);
    expect(editor.issues).toEqual([]);
    expect(await writeChanges(fs, saved, editor.model)).toEqual({
      written: ['layouts/catalog.json', 'subject-areas/catalog.yaml'],
      removed: ['entities/baesong.yaml'],
    });
    const after = (await loadModel(fs, '')).model;
    const catalog = after.subjectAreas.find(
      (item) => item.data.id === 'catalog',
    )!;
    expect(catalog.data.entities).toEqual([
      'category',
      'product',
      'product_tag',
      'tag',
    ]);
    const nodes = after.layouts.find(
      (item) => item.file === 'layouts/catalog.json',
    )!.data.nodes;
    expect(Object.keys(nodes)).toEqual([
      'category',
      'product',
      'product_tag',
      'tag',
    ]);
  });

  test('a delete changes only the areas and layouts that hold the entity, whole-model layouts included', () => {
    const layout = (file: string, nodes: string[], subjectArea?: string) => ({
      file,
      data: {
        formatVersion: '0.1' as const,
        ...(subjectArea ? { subjectArea } : {}),
        nodes: Object.fromEntries(nodes.map((id, i) => [id, { x: i, y: 0 }])),
      },
    });
    const model = handModel({
      entities: [entityItem('a'), entityItem('b')],
      subjectAreas: [areaItem('s', ['a', 'b']), areaItem('t', ['b'])],
      layouts: [
        layout('layouts/model.json', ['a', 'b']),
        layout('layouts/s.json', ['a', 'b'], 's'),
        layout('layouts/t.json', ['b'], 't'),
      ],
    });
    const editor = createEditor(model);
    expect(editor.issues).toEqual([]);
    expect(editor.execute({ type: 'entity.delete', id: 'a' }).ok).toBe(true);
    const next = editor.model;
    expect(next.entities.map((item) => item.data.id)).toEqual(['b']);
    expect(next.subjectAreas[0]!.data.entities).toEqual(['b']);
    expect(next.subjectAreas[1]).toBe(model.subjectAreas[1]);
    expect(Object.keys(next.layouts[0]!.data.nodes)).toEqual(['b']);
    expect(Object.keys(next.layouts[1]!.data.nodes)).toEqual(['b']);
    expect(next.layouts[2]).toBe(model.layouts[2]);
    expect(next.relationships).toBe(model.relationships);
    // The model it came from is as it was.
    expect(model.subjectAreas[0]!.data.entities).toEqual(['a', 'b']);
    expect(Object.keys(model.layouts[0]!.data.nodes)).toEqual(['a', 'b']);
  });

  test('attribute.delete takes the attribute out of the keys of its entity', async () => {
    const editor = createEditor(await exampleModel());
    expect(editor.issues).toEqual([]);
    const result = editor.execute({
      type: 'attribute.delete',
      entity: 'order',
      id: 'ord_dtm',
    });
    expect(result.ok).toBe(true);
    expect(editor.issues).toEqual([]);
    const keys = orderOf(editor).keys!;
    expect(keys.map((key) => [key.id, key.attributes])).toEqual([
      ['pk', ['ord_no']],
      ['ie_ord_dtm', ['cust_no']],
    ]);
  });

  test('a key left without attributes goes, and keys with it when it was the last', async () => {
    const editor = createEditor(await emptyModel());
    for (const command of [
      { type: 'entity.create', id: 'e', name: 'E' },
      { type: 'attribute.create', entity: 'e', id: 'a', name: 'A' },
      { type: 'attribute.create', entity: 'e', id: 'b', name: 'B' },
      { type: 'key.create', entity: 'e', kind: 'primary', attributes: ['a'] },
      {
        type: 'key.create',
        entity: 'e',
        kind: 'alternate',
        attributes: ['a', 'b'],
      },
      { type: 'key.create', entity: 'e', kind: 'inversion', attributes: ['b'] },
    ]) {
      expect(editor.execute(command).ok).toBe(true);
    }
    const data = () => editor.model.entities[0]!.data;
    expect(
      editor.execute({ type: 'attribute.delete', entity: 'e', id: 'a' }).ok,
    ).toBe(true);
    expect(data().keys).toEqual([
      { id: 'ak', kind: 'alternate', attributes: ['b'] },
      { id: 'ie', kind: 'inversion', attributes: ['b'] },
    ]);
    expect(
      editor.execute({ type: 'attribute.delete', entity: 'e', id: 'b' }).ok,
    ).toBe(true);
    expect(data()).toEqual({ id: 'e', name: 'E', attributes: [] });
  });

  test('a migrated attribute takes changes the relationships do not see, and moves', async () => {
    const commands: unknown[] = [
      {
        type: 'attribute.update',
        entity: 'order',
        id: 'cust_no',
        set: { definition: '주문한 고객.' },
      },
      {
        type: 'attribute.update',
        entity: 'order',
        id: 'cust_no',
        set: { nullable: true },
      },
      {
        type: 'attribute.update',
        entity: 'order',
        id: 'cust_no',
        set: { physical: { name: 'CUSTOMER_NO' } },
      },
      { type: 'attribute.move', entity: 'order', id: 'cust_no' },
    ];
    for (const command of commands) {
      const editor = createEditor(await exampleModel());
      const result = editor.execute(command);
      expect(result.ok).toBe(true);
      expect(succeeded(result).issues).toEqual([]);
    }
    const editor = createEditor(await exampleModel());
    expect(
      editor.execute({
        type: 'attribute.update',
        entity: 'order',
        id: 'cust_no',
        set: {
          migratedFrom: [
            { relationship: 'customer_places_order', attribute: 'cust_no' },
          ],
        },
      }),
    ).toEqual(
      refused('invalid-command', '/set must NOT have additional properties'),
    );
  });

  test('a missing attribute, key, subject area or before is not-found, in the words of appendix B', async () => {
    const editor = createEditor(await exampleModel());
    const model = editor.model;
    const cases: [unknown, string][] = [
      [
        { type: 'attribute.create', entity: 'missing', name: 'x' },
        'entity "missing" does not exist',
      ],
      [
        { type: 'attribute.update', entity: 'order', id: 'nope', set: {} },
        'attribute "nope" does not exist in entity "order"',
      ],
      [
        { type: 'attribute.delete', entity: 'order', id: 'nope' },
        'attribute "nope" does not exist in entity "order"',
      ],
      [
        { type: 'attribute.move', entity: 'order', id: 'nope' },
        'attribute "nope" does not exist in entity "order"',
      ],
      [
        {
          type: 'attribute.move',
          entity: 'order',
          id: 'ord_dtm',
          before: 'nope',
        },
        'attribute "nope" does not exist in entity "order"',
      ],
      [
        {
          type: 'attribute.create',
          entity: 'order',
          name: 'x',
          before: 'nope',
        },
        'attribute "nope" does not exist in entity "order"',
      ],
      [
        { type: 'key.update', entity: 'order', id: 'nope', set: {} },
        'key "nope" does not exist in entity "order"',
      ],
      [
        { type: 'key.delete', entity: 'order', id: 'nope' },
        'key "nope" does not exist in entity "order"',
      ],
      [
        { type: 'key.move', entity: 'order', id: 'pk', before: 'nope' },
        'key "nope" does not exist in entity "order"',
      ],
      [
        {
          type: 'key.create',
          entity: 'order',
          kind: 'alternate',
          attributes: ['ord_dtm'],
          before: 'nope',
        },
        'key "nope" does not exist in entity "order"',
      ],
      [
        { type: 'key.delete', entity: 'missing', id: 'pk' },
        'entity "missing" does not exist',
      ],
      [
        { type: 'subjectArea.update', id: 'nope', set: {} },
        'subject area "nope" does not exist',
      ],
      [
        { type: 'subjectArea.delete', id: 'nope' },
        'subject area "nope" does not exist',
      ],
      [
        { type: 'subjectArea.addEntities', id: 'nope', entities: ['order'] },
        'subject area "nope" does not exist',
      ],
      [
        { type: 'subjectArea.removeEntities', id: 'nope', entities: ['order'] },
        'subject area "nope" does not exist',
      ],
    ];
    for (const [command, message] of cases) {
      expect(editor.execute(command)).toEqual(refused('not-found', message));
      expect(editor.model).toBe(model);
    }
  });

  test('stored references are not looked up: the final validation sees them', async () => {
    const editor = createEditor(await exampleModel());
    const add = {
      type: 'subjectArea.addEntities',
      id: 'sales',
      entities: ['missing'],
    };
    const issue = {
      rule: 'R02',
      severity: 'error',
      file: 'subject-areas/sales.yaml',
      path: '/entities/5',
      message: 'unknown entity "missing"',
    };
    const result = editor.execute(add);
    expect(result).toMatchObject({ ok: false, code: 'validation' });
    expect(
      !result.ok &&
        result.issues.map(({ rule, file, message }) => [rule, file, message]),
    ).toEqual([[issue.rule, issue.file, issue.message]]);
    expect(
      editor.execute({
        type: 'batch',
        commands: [add, { type: 'entity.create', id: 'missing', name: 'M' }],
      }).ok,
    ).toBe(true);

    const keyed = createEditor(await exampleModel());
    const key = keyed.execute({
      type: 'key.create',
      entity: 'order',
      kind: 'alternate',
      attributes: ['nope'],
    });
    expect(key).toMatchObject({ ok: false, code: 'validation' });
    expect(!key.ok && key.issues.map((i) => i.rule)).toEqual(['R02']);
  });

  test('a used id with a missing subjectArea is not-found; a missing entity with a schema fault is invalid-command', async () => {
    const editor = createEditor(await exampleModel());
    expect(
      editor.execute({
        type: 'entity.create',
        id: 'order',
        name: 'X',
        subjectArea: 'missing',
      }),
    ).toEqual(refused('not-found', 'subject area "missing" does not exist'));
    expect(
      editor.execute({ type: 'attribute.create', entity: 'missing', name: 1 }),
    ).toEqual(refused('invalid-command', '/name must be string'));
  });

  test('two attributes or two keys of one id in one entity are ambiguous-target', () => {
    const attribute = { id: 'a', name: 'A' };
    const key = { id: 'k', kind: 'inversion' as const, attributes: ['a'] };
    const editor = createEditor(
      handModel({
        entities: [
          entityItem('e', {
            attributes: [attribute, { ...attribute }],
            keys: [key, { ...key, attributes: ['a'] }],
          }),
          entityItem('d'),
          entityItem('d', {}, 'entities/d2.yaml'),
        ],
      }),
    );
    const model = editor.model;
    const attr = 'attribute "a" is not unique in entity "e"';
    const keyMessage = 'key "k" is not unique in entity "e"';
    const cases: [unknown, string][] = [
      [
        { type: 'attribute.update', entity: 'e', id: 'a', set: { note: 'n' } },
        attr,
      ],
      [{ type: 'attribute.delete', entity: 'e', id: 'a' }, attr],
      [{ type: 'attribute.move', entity: 'e', id: 'a' }, attr],
      [{ type: 'attribute.create', entity: 'e', name: 'B', before: 'a' }, attr],
      [
        { type: 'key.update', entity: 'e', id: 'k', set: { name: 'n' } },
        keyMessage,
      ],
      [{ type: 'key.delete', entity: 'e', id: 'k' }, keyMessage],
      [{ type: 'key.move', entity: 'e', id: 'k' }, keyMessage],
      [
        { type: 'attribute.create', entity: 'd', name: 'B' },
        'entity "d" is not unique in the model',
      ],
    ];
    for (const [command, message] of cases) {
      expect(editor.execute(command)).toEqual(
        refused('ambiguous-target', message),
      );
      expect(editor.model).toBe(model);
    }
  });

  test('subjectArea.delete removes the layout of the area; removeEntities takes their nodes out of it', () => {
    const layout = (file: string, nodes: string[], subjectArea?: string) => ({
      file,
      data: {
        formatVersion: '0.1' as const,
        ...(subjectArea ? { subjectArea } : {}),
        nodes: Object.fromEntries(nodes.map((id, i) => [id, { x: i, y: 0 }])),
        edges: {},
      },
    });
    const model = handModel({
      entities: [entityItem('a'), entityItem('b')],
      subjectAreas: [areaItem('s', ['a', 'b']), areaItem('t', ['a', 'b'])],
      layouts: [
        layout('layouts/model.json', ['a', 'b']),
        layout('layouts/s.json', ['a', 'b'], 's'),
        layout('layouts/t.json', ['a', 'b'], 't'),
      ],
    });
    const editor = createEditor(model);
    expect(editor.issues).toEqual([]);
    expect(
      editor.execute({
        type: 'subjectArea.removeEntities',
        id: 's',
        entities: ['a', 'x'],
      }).ok,
    ).toBe(true);
    let next = editor.model;
    expect(next.subjectAreas[0]!.data.entities).toEqual(['b']);
    expect(Object.keys(next.layouts[1]!.data.nodes)).toEqual(['b']);
    expect(next.layouts[0]).toBe(model.layouts[0]);
    expect(next.layouts[2]).toBe(model.layouts[2]);
    expect(next.subjectAreas[1]).toBe(model.subjectAreas[1]);

    expect(editor.execute({ type: 'subjectArea.delete', id: 't' }).ok).toBe(
      true,
    );
    next = editor.model;
    expect(next.subjectAreas.map((item) => item.data.id)).toEqual(['s']);
    expect(next.layouts.map((item) => item.file)).toEqual([
      'layouts/model.json',
      'layouts/s.json',
    ]);
    expect(next.entities).toBe(model.entities);
  });

  test('a missing entity or subject area is not-found', async () => {
    const editor = createEditor(await exampleModel());
    expect(
      editor.execute({
        type: 'entity.update',
        id: 'missing',
        set: { note: 'n' },
      }),
    ).toEqual(refused('not-found', 'entity "missing" does not exist'));
    expect(editor.execute({ type: 'entity.delete', id: 'missing' })).toEqual(
      refused('not-found', 'entity "missing" does not exist'),
    );
    expect(
      editor.execute({
        type: 'entity.create',
        name: 'X',
        subjectArea: 'missing',
      }),
    ).toEqual(refused('not-found', 'subject area "missing" does not exist'));
  });

  test('lookups come before id-taken; the schema comes before lookups', async () => {
    const editor = createEditor(await exampleModel());
    expect(
      editor.execute({
        type: 'entity.create',
        id: 'order',
        name: 'X',
        subjectArea: 'missing',
      }),
    ).toEqual(refused('not-found', 'subject area "missing" does not exist'));
    expect(
      editor.execute({ type: 'entity.update', id: 'missing', set: { x: 1 } }),
    ).toEqual(
      refused('invalid-command', '/set must NOT have additional properties'),
    );
    expect(
      editor.execute({ type: 'entity.create', id: 'order', name: 'X' }),
    ).toEqual(refused('id-taken', 'entity id "order" is already used'));
  });

  test('an id two entities or two subject areas share is ambiguous-target', () => {
    const editor = createEditor(
      handModel({
        entities: [entityItem('a'), entityItem('a', {}, 'entities/a2.yaml')],
        subjectAreas: [
          areaItem('s'),
          { ...areaItem('s'), file: 'subject-areas/s2.yaml' },
        ],
      }),
    );
    const message = 'entity "a" is not unique in the model';
    expect(
      editor.execute({ type: 'entity.update', id: 'a', set: { note: 'n' } }),
    ).toEqual(refused('ambiguous-target', message));
    expect(editor.execute({ type: 'entity.delete', id: 'a' })).toEqual(
      refused('ambiguous-target', message),
    );
    expect(
      editor.execute({ type: 'entity.create', name: 'X', subjectArea: 's' }),
    ).toEqual(
      refused(
        'ambiguous-target',
        'subject area "s" is not unique in the model',
      ),
    );
  });
});
