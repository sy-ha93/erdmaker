import { describe, expect, test } from 'vitest';
import { SAMPLE_COMMANDS } from '../testing/commands.js';
import { emptyModel, exampleModel } from '../testing/editing.js';
import { createEditor } from './editor.js';
import type { Command, Editor } from './types.js';

/** The same JSON value, through text. */
const throughJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

async function startOf(
  sample: (typeof SAMPLE_COMMANDS)[number],
): Promise<Editor> {
  const editor = createEditor(
    sample.start === 'example' ? await exampleModel() : await emptyModel(),
  );
  for (const command of sample.before ?? []) {
    expect(editor.execute(command).ok).toBe(true);
  }
  return editor;
}

/** Typed so a field the command type does not have fails the type check. */
const typedCreate: Command = {
  type: 'attribute.create',
  entity: 'order',
  name: '메모',
  dataType: { base: 'string', length: 20 },
  nullable: true,
};

describe('명령 직렬화', () => {
  test.each(
    SAMPLE_COMMANDS.map((sample) => [sample.command.type, sample] as const),
  )(
    'the sample %s: the object and its JSON give equal results, and the result survives JSON',
    async (_type, sample) => {
      const direct = await startOf(sample);
      const parsed = await startOf(sample);
      const a = direct.execute(sample.command);
      const b = parsed.execute(throughJson(sample.command));
      expect(a.ok).toBe(true);
      expect(b).toEqual(a);
      expect(throughJson(a)).toEqual(a);
      expect(throughJson(direct.model)).toEqual(direct.model);
    },
  );

  test('a typed attribute.create runs, and its JSON alike', async () => {
    const direct = createEditor(await exampleModel());
    const parsed = createEditor(await exampleModel());
    const a = direct.execute(typedCreate);
    expect(a).toMatchObject({ ok: true, id: 'memo' });
    expect(parsed.execute(throughJson(typedCreate))).toEqual(a);
    expect(throughJson(a)).toEqual(a);
  });

  test('-0 in ext stays -0 from the object and is 0 through JSON', async () => {
    const command = { type: 'entity.create', name: 'a', ext: { z: -0 } };
    const direct = createEditor(await emptyModel());
    direct.execute(command);
    expect(Object.is(direct.model.entities[0]!.data.ext!.z, -0)).toBe(true);
    const parsed = createEditor(await emptyModel());
    parsed.execute(throughJson(command));
    expect(Object.is(parsed.model.entities[0]!.data.ext!.z, 0)).toBe(true);
  });

  test('the model and issues of an editor are read-only types', async () => {
    const editor = createEditor(await emptyModel());
    expect(editor.issues).toEqual([]);
    // Never called: only the type check looks at these lines.
    const writes = () => {
      // @ts-expect-error the data of an item is read-only
      editor.model.entities[0]!.data.name = 'x';
      // @ts-expect-error issues is a read-only list
      editor.issues.push(editor.issues[0]!);
      // @ts-expect-error an issue is read-only
      editor.issues[0]!.severity = 'warning';
    };
    expect(typeof writes).toBe('function');
  });

  test('the types take domain or a data type, not both, as the schema does', async () => {
    const editor = createEditor(await exampleModel());
    const withDomain: Command = {
      type: 'attribute.create',
      entity: 'order',
      name: '메모',
      domain: 'memo',
    };
    const both = {
      type: 'attribute.create',
      entity: 'order',
      name: '메모',
      domain: 'memo',
      dataType: { base: 'string' },
    } as const;
    // @ts-expect-error domain and dataType together
    const typedBoth: Command = both;
    const setBoth = {
      type: 'attribute.update',
      entity: 'order',
      id: 'ord_dtm',
      set: { domain: 'memo', type: { base: 'string' } },
    } as const;
    // @ts-expect-error set.domain and set.type together
    const typedSetBoth: Command = setBoth;
    expect(editor.execute(withDomain)).toMatchObject({
      ok: false,
      code: 'validation',
    });
    for (const command of [typedBoth, typedSetBoth]) {
      expect(editor.execute(command)).toMatchObject({
        ok: false,
        code: 'invalid-command',
      });
    }
  });
});
