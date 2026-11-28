import { describe, expect, test } from 'vitest';
import type { Model } from '../model/types.js';
import { validateModel } from '../validate/index.js';
import { entityItem, exampleModel, handModel } from '../testing/editing.js';
import { createEditor } from './editor.js';
import type { CommandResult, Editor } from './types.js';

const NOT_A_LIST =
  'Cannot edit the model: reservedFiles is not a list of paths';

/** Calls `make` and returns what it threw. */
function thrown(make: () => unknown): unknown {
  try {
    make();
  } catch (error) {
    return error;
  }
  throw new Error('nothing was thrown');
}

/** What an editor shows, to compare before and after a call. */
const state = (editor: Editor) => ({
  model: editor.model,
  issues: editor.issues,
  canUndo: editor.canUndo,
  canRedo: editor.canRedo,
});

function expectSameState(
  editor: Editor,
  before: ReturnType<typeof state>,
): void {
  expect(editor.model).toBe(before.model);
  expect(editor.issues).toBe(before.issues);
  expect(editor.canUndo).toBe(before.canUndo);
  expect(editor.canRedo).toBe(before.canRedo);
}

describe('편집기 만들기', () => {
  test('throws the TypeError of each FR-01 reason', () => {
    const entity = (file: string, id = 'a') => ({
      file,
      data: { id, name: id, attributes: [] },
    });
    const dictionary = (file: string) => ({ file, data: {} });
    const cases: [unknown, string][] = [
      [null, 'it is not an object'],
      [handModel({ dir: 'a//b' }), 'dir is not a normalized path'],
      [{ ...handModel(), entities: {} }, 'entities is not a list'],
      [{ ...handModel(), entities: [1] }, 'entities[0] is not an item'],
      [
        handModel({ entities: [entity('entities//a.yaml')] }),
        'entities//a.yaml is not a normalized file path',
      ],
      [
        handModel({ dictionaries: [dictionary('.')] }),
        '. is not a normalized file path',
      ],
      [
        handModel({
          dir: 'billing',
          entities: [entity('billing-old/entities/a.yaml')],
        }),
        'billing-old/entities/a.yaml is outside the model folder',
      ],
      [
        handModel({
          entities: [entity('entities/a.yaml'), entity('entities/a.yaml', 'b')],
        }),
        'entities/a.yaml is used by two items',
      ],
      [
        handModel({
          dictionaries: [
            dictionary('../dictionary/a.yaml'),
            dictionary('../dictionary/a.yaml'),
          ],
        }),
        '../dictionary/a.yaml is used by two items',
      ],
    ];
    for (const [model, reason] of cases) {
      const error = thrown(() => createEditor(model as Model));
      expect(error).toBeInstanceOf(TypeError);
      expect((error as TypeError).message).toBe(
        `Cannot edit the model: ${reason}`,
      );
    }
  });

  test('takes one dictionary outside the folder', () => {
    const model = handModel({
      dictionaries: [{ file: '../dictionary/a.yaml', data: {} }],
    });
    expect(createEditor(model).model).toBe(model);
  });

  test('a model with errors makes an editor whose issues hold them', () => {
    const model = handModel({
      entities: [
        entityItem('a', { physical: { name: 'T' } }),
        entityItem('b', { physical: { name: 'T' } }),
      ],
    });
    const editor = createEditor(model);
    expect(editor.issues).toEqual(validateModel(model));
    expect(editor.issues.map((issue) => issue.rule)).toEqual(['R11']);
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(false);
  });

  test('reservedFiles that is not an array of strings throws one TypeError', () => {
    const model = handModel();
    const throwing = {
      get reservedFiles(): string[] {
        throw new Error('getter');
      },
    };
    for (const options of [
      { reservedFiles: new Set(['a']) },
      { reservedFiles: 'entities/a.yaml' },
      { reservedFiles: [1] },
      { reservedFiles: ['a', null] },
      throwing,
      null,
    ]) {
      const error = thrown(() =>
        createEditor(model, options as { reservedFiles?: string[] }),
      );
      expect(error).toBeInstanceOf(TypeError);
      expect((error as TypeError).message).toBe(NOT_A_LIST);
    }
    // The model's own reason comes first.
    expect(
      (thrown(() => createEditor(null as never, null as never)) as Error)
        .message,
    ).toBe('Cannot edit the model: it is not an object');
    // Entries that normalize to nothing are ignored; absent is none.
    expect(() =>
      createEditor(model, { reservedFiles: ['', '.', 'a/..'] }),
    ).not.toThrow();
    expect(() =>
      createEditor(model, { reservedFiles: undefined }),
    ).not.toThrow();
    expect(() => createEditor(model, {})).not.toThrow();
  });

  test('each of the eight rejection codes leaves the model, issues, undo and redo as they were', () => {
    const model = handModel({
      entities: [
        entityItem('a'),
        entityItem('a', {}, 'entities/a-copy.yaml'),
        entityItem('t', { physical: { name: 'T' } }),
      ],
    });
    const editor = createEditor(model);
    expect(editor.execute({ type: 'entity.create', name: 'x' }).ok).toBe(true);
    expect(editor.execute({ type: 'entity.create', name: 'y' }).ok).toBe(true);
    expect(editor.undo().ok).toBe(true);
    const before = state(editor);
    expect(before.canUndo).toBe(true);
    expect(before.canRedo).toBe(true);

    const refused: [unknown, string][] = [
      [42, 'invalid-command'],
      [{ type: 'entity.delete', id: 'missing' }, 'not-found'],
      [{ type: 'entity.delete', id: 'a' }, 'ambiguous-target'],
      [{ type: 'entity.create', id: 'x', name: 'X' }, 'id-taken'],
      [
        { type: 'entity.create', name: 'u', physical: { name: 'T' } },
        'validation',
      ],
    ];
    for (const [command, code] of refused) {
      const result = editor.execute(command);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.code).toBe(code);
      expectSameState(editor, before);
    }

    let inner: CommandResult | undefined;
    const outer = editor.execute({
      type: 'entity.create',
      get name() {
        inner = editor.execute({ type: 'entity.create', name: 'z' });
        expectSameState(editor, before);
        throw new Error('getter');
      },
    });
    expect(inner).toEqual({
      ok: false,
      code: 'internal',
      message: 'The editor is busy',
      issues: [],
    });
    expect(outer).toEqual({
      ok: false,
      code: 'invalid-command',
      message: '/name must be a JSON value',
      issues: [],
    });
    expectSameState(editor, before);

    const fresh = createEditor(model);
    const start = state(fresh);
    expect(fresh.undo()).toEqual({
      ok: false,
      code: 'nothing-to-undo',
      message: 'Nothing to undo',
      issues: [],
    });
    expectSameState(fresh, start);
    expect(fresh.redo()).toEqual({
      ok: false,
      code: 'nothing-to-redo',
      message: 'Nothing to redo',
      issues: [],
    });
    expectSameState(fresh, start);
  });

  test('two editors made alike give equal results call by call', async () => {
    const model = await exampleModel();
    const options = { reservedFiles: ['entities/tag_2.yaml'] };
    const a = createEditor(model, options);
    const b = createEditor(model, options);
    const calls: ((editor: Editor) => CommandResult)[] = [
      (e) => e.execute({ type: 'entity.create', name: 'tag' }),
      (e) => e.execute({ type: 'entity.create', name: 'tag' }),
      (e) =>
        e.execute({ type: 'entity.update', id: 'tag_3', set: { note: 'n' } }),
      (e) => e.undo(),
      (e) => e.redo(),
      (e) => e.execute({ type: 'entity.delete', id: 'tag_3' }),
      (e) => e.execute({ type: 'entity.delete', id: 'tag' }),
      (e) => e.execute({ type: 'entity.rename' }),
      (e) => e.undo(),
      (e) => e.undo(),
      (e) => e.redo(),
      (e) => e.redo(),
      (e) => e.redo(),
    ];
    const ids: (string | undefined)[] = [];
    for (const call of calls) {
      const left = call(a);
      expect(left).toEqual(call(b));
      ids.push(left.ok ? left.id : undefined);
    }
    expect(ids.slice(0, 2)).toEqual(['tag_3', 'tag_4']);
  });

  test('the initial paths are part of the state', () => {
    const editor = createEditor(
      handModel({
        entities: [entityItem('customer', {}, 'entities/Customer.yaml')],
      }),
    );
    expect(editor.execute({ type: 'entity.delete', id: 'customer' }).ok).toBe(
      true,
    );
    const create = { type: 'entity.create', id: 'customer', name: 'C' };
    expect(editor.execute(create)).toEqual({
      ok: false,
      code: 'id-taken',
      message:
        'entity id "customer" cannot be used: a file with another letter case was loaded: entities/Customer.yaml',
      issues: [],
    });
    const again = createEditor(editor.model);
    const result = again.execute(create);
    expect(result.ok).toBe(true);
    expect(result.ok && result.id).toBe('customer');
    expect(again.model.entities.map((item) => item.file)).toEqual([
      'entities/customer.yaml',
    ]);
  });
});
