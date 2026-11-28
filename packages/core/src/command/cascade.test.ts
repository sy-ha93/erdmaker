import { describe, expect, test } from 'vitest';
import { createMemoryFileSystem } from '../fs/memory.js';
import { loadModel } from '../model/load.js';
import type { LayoutData } from '../model/types.js';
import {
  areaItem,
  cachedExampleFiles,
  entityItem,
  exampleModel,
  handModel,
} from '../testing/editing.js';
import { createEditor } from './editor.js';
import { writeChanges } from './write-changes.js';

const refused = (code: string, message: string) => ({
  ok: false,
  code,
  message,
  issues: [],
});

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

  test.todo(
    'attribute.delete, keys, migrated attributes and the stored references of AC-10 (phase 6)',
  );

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
