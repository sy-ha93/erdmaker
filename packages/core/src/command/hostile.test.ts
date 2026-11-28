import { describe, expect, test } from 'vitest';
import {
  ACCEPTED_INPUTS,
  REJECTED_INPUTS,
  SAMPLE_COMMANDS,
} from '../testing/commands.js';
import { emptyModel, exampleModel } from '../testing/editing.js';
import { createEditor } from './editor.js';
import type { CommandResult } from './types.js';

/** Every object reachable from `value`. */
function objectsOf(value: unknown): Set<object> {
  const out = new Set<object>();
  const stack = [value];
  while (stack.length > 0) {
    const next = stack.pop();
    if (typeof next !== 'object' || next === null || out.has(next)) continue;
    out.add(next);
    for (const child of Object.values(next)) stack.push(child);
  }
  return out;
}

describe('믿을 수 없는 입력', () => {
  test.each(REJECTED_INPUTS.map((row) => [row.name, row] as const))(
    'refused: %s',
    async (_name, row) => {
      const editor = createEditor(await emptyModel());
      const model = editor.model;
      try {
        let result: CommandResult | undefined;
        expect(() => {
          result = editor.execute(row.input());
        }).not.toThrow();
        expect(result).toEqual({
          ok: false,
          code: 'invalid-command',
          message: row.message,
          issues: [],
        });
        expect(typeof result!.ok).toBe('boolean');
        expect(editor.model).toBe(model);
        expect(editor.canUndo).toBe(false);
      } finally {
        row.cleanup?.();
      }
      expect(({} as Record<string, unknown>).x).toBeUndefined();
    },
  );

  const entityRows = ACCEPTED_INPUTS.filter(
    (row) => (row.copy() as { type: string }).type === 'entity.create',
  );
  test.each(entityRows.map((row) => [row.name, row] as const))(
    'taken: %s',
    async (_name, row) => {
      const editor = createEditor(await emptyModel());
      const result = editor.execute(row.input());
      expect(result.ok).toBe(true);
      const copy = row.copy() as Record<string, unknown>;
      const { type: _type, ...fields } = copy;
      void _type;
      const created = editor.model.entities[0]!;
      expect(created.data).toEqual({
        ...fields,
        id: result.ok ? result.id : undefined,
        attributes: [],
      });
      if ('ext' in copy) {
        expect(Object.getPrototypeOf(created.data.ext)).toBe(Object.prototype);
        expect(Object.keys(created.data.ext!)).toEqual(
          Object.keys(copy.ext as object),
        );
      }
    },
  );
  const areaRows = ACCEPTED_INPUTS.filter((row) => !entityRows.includes(row));
  test('every accepted row is an entity.create or a subjectArea.create', () => {
    for (const row of areaRows) {
      expect((row.copy() as { type: string }).type).toBe('subjectArea.create');
    }
    expect(areaRows.length).toBe(2);
  });
  test.each(areaRows.map((row) => [row.name, row] as const))(
    'taken: %s',
    async (_name, row) => {
      const editor = createEditor(await exampleModel());
      const result = editor.execute(row.input());
      expect(result).toMatchObject({ ok: true, id: 'a' });
      const copy = row.copy() as Record<string, unknown>;
      const { type: _type, ...fields } = copy;
      void _type;
      const created = editor.model.subjectAreas.at(-1)!;
      expect(created).toEqual({
        file: 'subject-areas/a.yaml',
        data: { ...fields, id: 'a' },
      });
      expect(created.data.entities).toEqual(['product']);
    },
  );

  test('a getter that calls the editor gets busy; the getter throwing refuses the outer call', async () => {
    const editor = createEditor(await emptyModel());
    const model = editor.model;
    let inner: CommandResult | undefined;
    const outer = editor.execute({
      type: 'entity.create',
      get name(): string {
        inner = editor.execute({ type: 'entity.create', name: 'b' });
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
    expect(editor.model).toBe(model);
    expect(editor.canUndo).toBe(false);
    // Not busy any more.
    expect(editor.execute({ type: 'entity.create', name: 'c' }).ok).toBe(true);
  });

  test('changing the command after it ran does not change the model', async () => {
    const editor = createEditor(await emptyModel());
    const command = {
      type: 'entity.create',
      name: 'a',
      physical: { name: 'A' },
      ext: { list: [1, { deep: true }] },
    };
    expect(editor.execute(command).ok).toBe(true);
    const data = editor.model.entities[0]!.data;
    command.ext.list.push(2);
    (command.ext.list[1] as { deep: boolean }).deep = false;
    command.physical.name = 'B';
    expect(data.ext).toEqual({ list: [1, { deep: true }] });
    expect(data.physical).toEqual({ name: 'A' });
    expect(data.ext).not.toBe(command.ext);
    expect(data.physical).not.toBe(command.physical);
  });

  test.each(
    SAMPLE_COMMANDS.map((sample) => [sample.command.type, sample] as const),
  )(
    'the values the sample %s put in share no object with the command or the rest of the model',
    async (_type, sample) => {
      const editor = createEditor(
        sample.start === 'example' ? await exampleModel() : await emptyModel(),
      );
      for (const command of sample.before ?? []) {
        expect(editor.execute(command).ok).toBe(true);
      }
      const before = editor.model;
      const command = JSON.parse(JSON.stringify(sample.command)) as object;
      expect(editor.execute(command).ok).toBe(true);
      const commandObjects = objectsOf(command);
      // The objects of the model before the command, which may stay shared.
      const old = objectsOf(before);
      const seen = new Map<object, string>();
      const stack: [unknown, string][] = [[editor.model, '']];
      while (stack.length > 0) {
        const [value, path] = stack.pop()!;
        if (typeof value !== 'object' || value === null) continue;
        expect(commandObjects.has(value), path).toBe(false);
        if (old.has(value)) continue;
        // A new object reached twice is shared between two places.
        expect(seen.get(value), path).toBeUndefined();
        seen.set(value, path);
        for (const [key, child] of Object.entries(value)) {
          stack.push([child, `${path}/${key}`]);
        }
      }
    },
  );
});

describe('거부 문구', () => {
  const lined = REJECTED_INPUTS.filter((row) => row.raw !== undefined);

  test('the rows whose raw message is not one line come out as one line', async () => {
    expect(lined.length).toBeGreaterThan(0);
    for (const row of lined) {
      const editor = createEditor(await emptyModel());
      try {
        const result = editor.execute(row.input());
        expect(!result.ok && result.message).toBe(row.message);
        expect(row.message).not.toBe(row.raw);
        expect(/[\n\r\u2028\u2029]/u.test(row.message)).toBe(false);
      } finally {
        row.cleanup?.();
      }
    }
  });

  test('a message longer than 500 code points is cut after 500 with …', async () => {
    const row = REJECTED_INPUTS.find(
      (candidate) => candidate.name === 'a message longer than 500 code points',
    )!;
    const editor = createEditor(await emptyModel());
    const result = editor.execute(row.input());
    const message = !result.ok ? result.message : '';
    expect(message).toBe(row.message);
    expect([...message].length).toBe(501);
    expect(message.endsWith('…')).toBe(true);
  });
});
