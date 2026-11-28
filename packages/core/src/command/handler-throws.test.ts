import { beforeEach, describe, expect, test, vi } from 'vitest';
import { emptyModel } from '../testing/editing.js';
import { createEditor } from './editor.js';
import { createEntity } from './handlers/entity.js';

vi.mock('./handlers/entity.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./handlers/entity.js')>();
  return { ...actual, createEntity: vi.fn(actual.createEntity) };
});

const create = { type: 'entity.create', name: 'a' };

describe('처리가 던지면', () => {
  beforeEach(() => {
    vi.mocked(createEntity).mockReset();
  });

  const throwing: [string, unknown, string][] = [
    ['an Error', new Error('boom'), 'Unexpected error: boom'],
    ['a TypeError', new TypeError('bad'), 'Unexpected error: bad'],
    ['a value that is not an Error', 42, 'Unexpected error: 42'],
    ['a string with a line break', 'a\nb', 'Unexpected error: a\\nb'],
    [
      'a value whose String() throws',
      {
        toString() {
          throw new Error('no text');
        },
      },
      'Unexpected error: unknown error',
    ],
    [
      'an Error whose message getter throws',
      Object.defineProperty(new Error('x'), 'message', {
        get() {
          throw new Error('no message');
        },
      }),
      'Unexpected error: unknown error',
    ],
  ];

  test.each(throwing)(
    '%s is an internal refusal',
    async (_name, value, message) => {
      const editor = createEditor(await emptyModel());
      const model = editor.model;
      const issues = editor.issues;
      vi.mocked(createEntity).mockImplementation(() => {
        throw value;
      });
      expect(editor.execute(create)).toEqual({
        ok: false,
        code: 'internal',
        message,
        issues: [],
      });
      expect(editor.model).toBe(model);
      expect(editor.issues).toBe(issues);
      expect(editor.canUndo).toBe(false);

      // The editor is not left busy.
      expect(editor.execute({ type: 'entity.delete', id: 'missing' })).toEqual({
        ok: false,
        code: 'not-found',
        message: 'entity "missing" does not exist',
        issues: [],
      });
    },
  );

  test('inside a batch the refusal names the sub-command that threw', async () => {
    const editor = createEditor(await emptyModel());
    const model = editor.model;
    vi.mocked(createEntity)
      .mockImplementationOnce(() => ({ ok: true, id: 'a' }))
      .mockImplementation(() => {
        throw new Error('boom');
      });
    expect(
      editor.execute({ type: 'batch', commands: [create, create] }),
    ).toEqual({
      ok: false,
      code: 'internal',
      message: 'commands[1]: Unexpected error: boom',
      issues: [],
      index: 1,
    });
    expect(editor.model).toBe(model);
  });
});
