import { describe, expect, test } from 'vitest';
import type { FileSystemAdapter } from '../fs/adapter.js';
import { createMemoryFileSystem } from '../fs/memory.js';
import { loadModel } from '../model/load.js';
import { serializeModel } from '../model/serialize.js';
import { validateModel } from '../validate/index.js';
import {
  cachedExampleFiles,
  EMPTY_MANIFEST,
  succeeded,
} from '../testing/editing.js';
import { createEditor } from './editor.js';
import type { Editor } from './types.js';
import { writeChanges } from './write-changes.js';

/**
 * Saves the editor's model over `fs` and reads it back: no issues on reading
 * or validating, and the same files as the editor's model would write.
 */
async function expectReadBack(
  fs: FileSystemAdapter,
  editor: Editor,
  start: Parameters<typeof writeChanges>[1],
) {
  await writeChanges(fs, start, editor.model);
  const read = await loadModel(fs, '');
  expect(read.issues).toEqual([]);
  expect(validateModel(read.model)).toEqual([]);
  expect(serializeModel(read.model)).toEqual(serializeModel(editor.model));
  return read.model;
}

describe('다시 읽기', () => {
  test('a new entity and a new subject area on the example read back as saved', async () => {
    const fs = createMemoryFileSystem(cachedExampleFiles());
    const start = (await loadModel(fs, '')).model;
    const editor = createEditor(start);
    expect(
      succeeded(editor.execute({ type: 'entity.create', name: '배송' })).id,
    ).toBe('baesong');
    const area = succeeded(
      editor.execute({
        type: 'subjectArea.create',
        name: '배송 영역',
        entities: ['product', 'address'],
      }),
    );
    expect(editor.issues).toEqual([]);

    const read = await expectReadBack(fs, editor, start);
    const ids = read.entities.map((item) => item.data.id);
    expect(ids).toHaveLength(11);
    // The editor adds at the end of the list; reading again sorts by file.
    expect(editor.model.entities.at(-1)!.data.id).toBe('baesong');
    expect(ids.indexOf('baesong')).toBe(ids.indexOf('address') + 1);
    expect(ids.indexOf('category')).toBe(ids.indexOf('baesong') + 1);
    const readArea = read.subjectAreas.find(
      (item) => item.data.id === area.id,
    )!;
    expect(readArea.file).toBe(`subject-areas/${area.id!}.yaml`);
    expect(readArea.data.entities).toEqual(['address', 'product']);
  });

  test('dictionaries: [entities]: a new entity is refused, a new subject area reads back', async () => {
    const fs = createMemoryFileSystem({
      'model.yaml': `${EMPTY_MANIFEST}dictionaries:\n  - entities\n`,
    });
    const start = (await loadModel(fs, '')).model;
    const editor = createEditor(start);
    const refused = editor.execute({ type: 'entity.create', name: 'Customer' });
    expect(refused).toEqual({
      ok: false,
      code: 'id-taken',
      message:
        'entity id "customer" cannot be used: entities/customer.yaml is inside the dictionary folder entities',
      issues: [],
    });
    expect(editor.model).toBe(start);

    succeeded(editor.execute({ type: 'subjectArea.create', name: 'Sales' }));
    const read = await expectReadBack(fs, editor, start);
    expect(read.subjectAreas.map((item) => item.file)).toEqual([
      'subject-areas/sales.yaml',
    ]);
  });
});
