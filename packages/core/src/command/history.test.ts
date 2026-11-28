import { describe, expect, test, vi } from 'vitest';
import { validateModel } from '../validate/index.js';
import type { ReadonlyModel } from '../model/types.js';
import { emptyModel, handModel, succeeded } from '../testing/editing.js';
import { createEditor } from './editor.js';

vi.mock('../validate/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../validate/index.js')>();
  return { ...actual, validateModel: vi.fn(actual.validateModel) };
});

const create = (name: string) => ({ type: 'entity.create', name });

describe('이력', () => {
  test('a new editor has nothing to undo or redo', async () => {
    const editor = createEditor(await emptyModel());
    expect(editor.undo()).toEqual({
      ok: false,
      code: 'nothing-to-undo',
      message: 'Nothing to undo',
      issues: [],
    });
    expect(editor.redo()).toEqual({
      ok: false,
      code: 'nothing-to-redo',
      message: 'Nothing to redo',
      issues: [],
    });
  });

  test('three commands, three undos back to the first model, three redos to the last', async () => {
    const first = await emptyModel();
    const editor = createEditor(first);
    const models: ReadonlyModel[] = [first];
    for (const name of ['a', 'b', 'c']) {
      const result = editor.execute(create(name));
      expect(result.ok).toBe(true);
      expect(succeeded(result).model).toBe(editor.model);
      models.push(editor.model);
    }
    for (let i = 2; i >= 0; i -= 1) {
      const result = editor.undo();
      expect(result.ok).toBe(true);
      expect(succeeded(result).model).toBe(models[i]);
      expect(editor.model).toBe(models[i]);
    }
    expect(editor.model).toBe(first);
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(true);
    for (let i = 1; i <= 3; i += 1) {
      const result = editor.redo();
      expect(result.ok).toBe(true);
      expect(editor.model).toBe(models[i]);
    }
    expect(editor.model).toBe(models[3]);
    expect(editor.canRedo).toBe(false);
  });

  test('a new command that succeeds after an undo clears redo', async () => {
    const editor = createEditor(await emptyModel());
    editor.execute(create('a'));
    editor.undo();
    expect(editor.canRedo).toBe(true);
    expect(editor.execute(create('b')).ok).toBe(true);
    expect(editor.canRedo).toBe(false);
    expect(editor.redo().ok).toBe(false);
  });

  test('a refused command and a command that changes nothing after an undo keep redo', async () => {
    const editor = createEditor(await emptyModel());
    editor.execute(create('a'));
    editor.execute(create('b'));
    const changed = editor.model;
    editor.undo();
    const undone = editor.model;
    const refused = editor.execute({ type: 'entity.delete', id: 'missing' });
    expect(refused.ok).toBe(false);
    expect(editor.canRedo).toBe(true);
    const same = editor.execute({ type: 'entity.update', id: 'a', set: {} });
    expect(same.ok).toBe(true);
    expect(succeeded(same).model).toBe(undone);
    expect(editor.canRedo).toBe(true);
    expect(editor.redo().ok).toBe(true);
    expect(editor.model).toBe(changed);
  });

  test('101 commands: 100 undos succeed and the 101st has nothing to undo', async () => {
    const editor = createEditor(await emptyModel());
    const models: ReadonlyModel[] = [];
    for (let i = 0; i < 101; i += 1) {
      expect(editor.execute(create(`e${i}`)).ok).toBe(true);
      models.push(editor.model);
    }
    for (let i = 0; i < 100; i += 1) {
      expect(editor.undo().ok).toBe(true);
    }
    // The oldest step was dropped: the model after the first command stays.
    expect(editor.model).toBe(models[0]);
    expect(editor.canUndo).toBe(false);
    expect(editor.undo()).toEqual({
      ok: false,
      code: 'nothing-to-undo',
      message: 'Nothing to undo',
      issues: [],
    });
    for (let i = 0; i < 100; i += 1) expect(editor.redo().ok).toBe(true);
    expect(editor.model).toBe(models[100]);
  });

  test('undo and redo call no validation and bring back the stored model and issues', () => {
    const editor = createEditor(
      handModel({
        entities: [
          {
            file: 'entities/a.yaml',
            data: {
              id: 'a',
              name: 'a',
              attributes: [],
              physical: { name: 'T' },
            },
          },
          {
            file: 'entities/b.yaml',
            data: {
              id: 'b',
              name: 'b',
              attributes: [],
              physical: { name: 'T' },
            },
          },
        ],
      }),
    );
    const beforeModel = editor.model;
    const beforeIssues = editor.issues;
    expect(beforeIssues.length).toBe(1);
    vi.mocked(validateModel).mockClear();
    const done = editor.execute({ type: 'entity.delete', id: 'b' });
    expect(done.ok).toBe(true);
    expect(validateModel).toHaveBeenCalledTimes(1);
    const afterModel = editor.model;
    const afterIssues = editor.issues;
    expect(afterIssues).toEqual([]);

    vi.mocked(validateModel).mockClear();
    const undone = editor.undo();
    expect(validateModel).toHaveBeenCalledTimes(0);
    expect(undone).toEqual({
      ok: true,
      model: beforeModel,
      issues: beforeIssues,
    });
    expect(succeeded(undone).model).toBe(beforeModel);
    expect(undone.issues).toBe(beforeIssues);
    expect(editor.issues).toBe(beforeIssues);

    vi.mocked(validateModel).mockClear();
    const redone = editor.redo();
    expect(validateModel).toHaveBeenCalledTimes(0);
    expect(succeeded(redone).model).toBe(afterModel);
    expect(redone.issues).toBe(afterIssues);
    expect(editor.model).toBe(afterModel);
    expect(editor.issues).toBe(afterIssues);
  });

  test.todo(
    'AC-07 (가) model: deleting one of the two primary keys and undoing brings R03 back (key.delete, phase 6)',
  );
});
