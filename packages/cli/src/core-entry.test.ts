import {
  type Command,
  type CommandResult,
  commandSchemas,
  createEditor,
  createMemoryFileSystem,
  type Editor,
  findModels,
  listReservedFiles,
  loadModel,
  type ReadonlyModel,
  type RejectionCode,
  serializeModel,
  validateModel,
  validateProject,
  writeChanges,
  writeModel,
} from '@erdmaker/core';
import { describe, expect, test } from 'vitest';

/** Whether `value` and everything in it is frozen. */
function deeplyFrozen(value: unknown): boolean {
  const stack = [value];
  while (stack.length > 0) {
    const next = stack.pop();
    if (typeof next !== 'object' || next === null) continue;
    if (!Object.isFrozen(next)) return false;
    for (const child of Object.values(next)) stack.push(child);
  }
  return true;
}

describe('명령 직렬화: 공개 이름', () => {
  test('the built @erdmaker/core gives the four values of FR-01 and keeps those of F02', async () => {
    for (const value of [createEditor, writeChanges, listReservedFiles]) {
      expect(typeof value).toBe('function');
    }
    expect(deeplyFrozen(commandSchemas)).toBe(true);
    expect(Object.keys(commandSchemas)).toHaveLength(17);
    for (const value of [
      createMemoryFileSystem,
      findModels,
      loadModel,
      serializeModel,
      validateModel,
      validateProject,
      writeModel,
    ]) {
      expect(typeof value).toBe('function');
    }

    const fs = createMemoryFileSystem({
      'model.yaml': 'formatVersion: "0.1"\nid: m\nname: M\n',
    });
    const model: ReadonlyModel = (await loadModel(fs, '')).model;
    const editor: Editor = createEditor(model);
    const command: Command = { type: 'entity.create', name: '배송' };
    const result: CommandResult = editor.execute(command);
    expect(result).toMatchObject({ ok: true, id: 'baesong' });
    const refused: CommandResult = editor.undo();
    const code: RejectionCode | undefined = refused.ok
      ? undefined
      : refused.code;
    expect(code).toBeUndefined();
    expect(editor.undo()).toMatchObject({ ok: false, code: 'nothing-to-undo' });
  });
});
