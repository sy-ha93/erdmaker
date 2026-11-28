import { describe, expect, test } from 'vitest';
import { loadModel } from '../model/load.js';
import type { ReadonlyModel } from '../model/types.js';
import { SAMPLE_COMMANDS, type SampleCommand } from '../testing/commands.js';
import {
  adapterFiles,
  cachedExampleFiles,
  emptyFiles,
  succeeded,
} from '../testing/editing.js';
import { recordingFileSystem } from '../testing/recording-fs.js';
import { createEditor } from './editor.js';
import { writeChanges } from './write-changes.js';

/** What saving a sample writes and removes, from the items it touches. */
function expectedSave(sample: SampleCommand, model: ReadonlyModel) {
  const items = sample.items!(model);
  const files = Object.keys(items).sort();
  return {
    written: files.filter((file) => items[file] !== null),
    removed: files.filter((file) => items[file] === null),
  };
}

/** The sample's start model, saved: its start files with `before` run and written. */
async function savedStart(sample: SampleCommand) {
  const fs = recordingFileSystem(
    sample.start === 'example' ? cachedExampleFiles() : emptyFiles(),
  );
  const loaded = (await loadModel(fs, '')).model;
  const editor = createEditor(loaded);
  for (const command of sample.before ?? []) {
    succeeded(editor.execute(command));
  }
  await writeChanges(fs, loaded, editor.model);
  return { fs, editor, start: editor.model };
}

describe('실행 취소 왕복', () => {
  test('the samples cover every kind and each changes the model', () => {
    expect(new Set(SAMPLE_COMMANDS.map((s) => s.command.type)).size).toBe(17);
    for (const sample of SAMPLE_COMMANDS) expect(sample.items).toBeDefined();
  });

  test.each(SAMPLE_COMMANDS.map((sample) => [sample.command.type, sample]))(
    '%s: run, save, undo, save gives the bytes back; redo, save gives the middle',
    async (_type, sample) => {
      const { fs, editor, start } = await savedStart(sample);
      const startFiles = await adapterFiles(fs);
      const expected = expectedSave(sample, start);

      const result = succeeded(editor.execute(sample.command));
      expect(result.model).not.toBe(start);
      expect(await writeChanges(fs, start, editor.model)).toEqual(expected);
      const middle = editor.model;
      const middleFiles = await adapterFiles(fs);

      succeeded(editor.undo());
      await writeChanges(fs, middle, editor.model);
      expect(await adapterFiles(fs)).toEqual(startFiles);
      expect(editor.model).toBe(start);

      succeeded(editor.redo());
      expect(editor.model).toBe(middle);
      await writeChanges(fs, start, editor.model);
      expect(await adapterFiles(fs)).toEqual(middleFiles);
    },
  );

  test('the spec lists: an entity.create on the example writes its file, subjectArea.delete removes two', async () => {
    const fs = recordingFileSystem(cachedExampleFiles());
    const loaded = (await loadModel(fs, '')).model;
    const editor = createEditor(loaded);
    const created = succeeded(
      editor.execute({ type: 'entity.create', name: '배송' }),
    );
    expect(created.id).toBe('baesong');
    expect(await writeChanges(fs, loaded, editor.model)).toEqual({
      written: ['entities/baesong.yaml'],
      removed: [],
    });
    const withEntity = editor.model;
    succeeded(editor.undo());
    expect(await writeChanges(fs, withEntity, editor.model)).toEqual({
      written: [],
      removed: ['entities/baesong.yaml'],
    });
    expect(editor.model).toBe(loaded);

    succeeded(editor.execute({ type: 'subjectArea.delete', id: 'sales' }));
    expect(await writeChanges(fs, loaded, editor.model)).toEqual({
      written: [],
      removed: ['layouts/sales.json', 'subject-areas/sales.yaml'],
    });
    const deleted = editor.model;
    succeeded(editor.undo());
    expect(await writeChanges(fs, deleted, editor.model)).toEqual({
      written: ['layouts/sales.json', 'subject-areas/sales.yaml'],
      removed: [],
    });
    expect(await adapterFiles(fs)).toEqual(
      new Map(
        Object.entries(cachedExampleFiles()).sort(([a], [b]) =>
          a < b ? -1 : 1,
        ),
      ),
    );
  });

  test('a commented file: update, undo, save makes no adapter call and the comment stays', async () => {
    const files = cachedExampleFiles();
    const text = `# 주문 엔터티\n${files['entities/order.yaml']!}`;
    files['entities/order.yaml'] = text;
    const fs = recordingFileSystem(files);
    const loaded = (await loadModel(fs, '')).model;
    const editor = createEditor(loaded);
    succeeded(
      editor.execute({
        type: 'attribute.update',
        entity: 'order',
        id: 'ord_dtm',
        set: { definition: '주문한 시각.' },
      }),
    );
    succeeded(editor.undo());
    fs.clear();
    expect(await writeChanges(fs, loaded, editor.model)).toEqual({
      written: [],
      removed: [],
    });
    expect(fs.calls).toEqual([]);
    expect(await fs.readText('entities/order.yaml')).toBe(text);
  });
});
