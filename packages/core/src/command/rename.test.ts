import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';
import { createMemoryFileSystem } from '../fs/memory.js';
import { loadModel } from '../model/load.js';
import type { ReadonlyModel } from '../model/types.js';
import { cachedExampleFiles } from '../testing/editing.js';
import { createEditor } from './editor.js';
import { writeChanges } from './write-changes.js';

const ORDER = 'entities/order.yaml';

/** Where each rename of AC-04 lands: the file, and the object's id in it. */
const RENAMES: [string, unknown, string, (data: never) => string][] = [
  [
    'entity name',
    { type: 'entity.update', id: 'order', set: { name: '주문서' } },
    ORDER,
    (data: { id: string }) => data.id,
  ],
  [
    'entity physical.name',
    {
      type: 'entity.update',
      id: 'order',
      set: { physical: { name: 'ORDER_HEADERS' } },
    },
    ORDER,
    (data: { id: string }) => data.id,
  ],
  [
    'attribute name',
    {
      type: 'attribute.update',
      entity: 'order',
      id: 'ord_dtm',
      set: { name: '주문시각' },
    },
    ORDER,
    (data: { attributes: { id: string }[] }) => data.attributes[4]!.id,
  ],
  [
    'attribute physical.name',
    {
      type: 'attribute.update',
      entity: 'order',
      id: 'ord_dtm',
      set: { physical: { name: 'ORDERED_AT' } },
    },
    ORDER,
    (data: { attributes: { id: string }[] }) => data.attributes[4]!.id,
  ],
  [
    'key name',
    {
      type: 'key.update',
      entity: 'order',
      id: 'ie_ord_dtm',
      set: { name: '고객별 주문일시' },
    },
    ORDER,
    (data: { keys: { id: string }[] }) => data.keys[1]!.id,
  ],
  [
    'key physical.name',
    {
      type: 'key.update',
      entity: 'order',
      id: 'ie_ord_dtm',
      set: { physical: { name: 'IX_ORDERS_BY_CUSTOMER' } },
    },
    ORDER,
    (data: { keys: { id: string }[] }) => data.keys[1]!.id,
  ],
  [
    'subject area name',
    { type: 'subjectArea.update', id: 'sales', set: { name: '판매' } },
    'subject-areas/sales.yaml',
    (data: { id: string }) => data.id,
  ],
];

/** Every item of the five saved lists, by file. */
function items(model: ReadonlyModel): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const list of [
    model.entities,
    model.relationships,
    model.subtypes,
    model.subjectAreas,
    model.layouts,
  ]) {
    for (const item of list) out.set(item.file, item.data);
  }
  return out;
}

describe('이름 변경', () => {
  test.each(RENAMES)(
    '%s: the id and the file stay, one file is written',
    async (_name, command, file, idIn) => {
      const fs = createMemoryFileSystem(cachedExampleFiles());
      const loaded = (await loadModel(fs, '')).model;
      const editor = createEditor(loaded);
      const before = items(loaded);
      const idBefore = idIn(before.get(file) as never);
      expect(editor.execute(command).ok).toBe(true);
      const after = items(editor.model);
      expect([...after.keys()]).toEqual([...before.keys()]);
      expect(idIn(after.get(file) as never)).toBe(idBefore);
      expect(await writeChanges(fs, loaded, editor.model)).toEqual({
        written: [file],
        removed: [],
      });
      const written = parse(await fs.readText(file)) as never;
      expect(idIn(written)).toBe(idBefore);
    },
  );

  test('an id in set is invalid-command', async () => {
    const editor = createEditor(
      (await loadModel(createMemoryFileSystem(cachedExampleFiles()), '')).model,
    );
    for (const command of [
      { type: 'entity.update', id: 'order', set: { id: 'orders' } },
      {
        type: 'attribute.update',
        entity: 'order',
        id: 'ord_dtm',
        set: { id: 'x' },
      },
      { type: 'key.update', entity: 'order', id: 'pk', set: { id: 'x' } },
      { type: 'subjectArea.update', id: 'sales', set: { id: 'x' } },
    ]) {
      expect(editor.execute(command)).toEqual({
        ok: false,
        code: 'invalid-command',
        message: '/set must NOT have additional properties',
        issues: [],
      });
    }
  });
});
