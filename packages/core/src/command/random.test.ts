import { describe, expect, test } from 'vitest';
import type { ReadonlyModel } from '../model/types.js';
import { deepFreeze, exampleModel, snapshotOf } from '../testing/editing.js';
import { Random } from '../testing/generate.js';
import { createEditor } from './editor.js';
import { errorCount } from './changes.js';
import type { Editor } from './types.js';

const RUNS = 2500;

/** An id from `ids`, sometimes one that is not there. */
const anyId = (random: Random, ids: readonly string[]): string =>
  ids.length === 0 || random.chance(0.1) ? 'missing' : random.pick(ids);

const NAMES = ['메모', 'Order Item', 'x', 'CON', '고객', 'tag'];

/** One random sub-command of any of the 16 kinds, aimed at `model`. */
function subCommand(random: Random, model: ReadonlyModel): object {
  const entities = model.entities.map((item) => item.data);
  const entityIds = entities.map((data) => data.id);
  const areas = model.subjectAreas.map((item) => item.data.id);
  const entity = anyId(random, entityIds);
  const data = entities.find((candidate) => candidate.id === entity);
  const attributes = (data?.attributes ?? []).map((a) => a.id);
  const keys = (data?.keys ?? []).map((k) => k.id);
  const name = random.pick(NAMES);
  const maybe = <T>(value: T) => (random.chance(0.5) ? value : undefined);
  switch (random.int(0, 15)) {
    case 0:
      return {
        type: 'entity.create',
        name,
        subjectArea: maybe(anyId(random, areas)),
        physical: maybe({ name: name.toUpperCase() }),
      };
    case 1:
      return {
        type: 'entity.update',
        id: entity,
        set: { note: name, ...(random.chance(0.3) ? { scope: 'both' } : {}) },
        unset: maybe(['definition']),
      };
    case 2:
      return { type: 'entity.delete', id: entity };
    case 3:
      return {
        type: 'attribute.create',
        entity,
        name,
        before: maybe(anyId(random, attributes)),
        dataType: maybe({ base: 'string' }),
      };
    case 4:
      return {
        type: 'attribute.update',
        entity,
        id: anyId(random, attributes),
        set: random.chance(0.5)
          ? { definition: name }
          : { physical: { name: name.toUpperCase() } },
        unset: maybe(['physical.name']),
      };
    case 5:
      return {
        type: 'attribute.delete',
        entity,
        id: anyId(random, attributes),
      };
    case 6:
      return {
        type: 'attribute.move',
        entity,
        id: anyId(random, attributes),
        before: maybe(anyId(random, attributes)),
      };
    case 7:
      return {
        type: 'key.create',
        entity,
        kind: random.pick(['primary', 'alternate', 'inversion']),
        attributes: [anyId(random, attributes)],
        before: maybe(anyId(random, keys)),
      };
    case 8:
      return {
        type: 'key.update',
        entity,
        id: anyId(random, keys),
        set: { name },
        unset: maybe(['physical']),
      };
    case 9:
      return { type: 'key.delete', entity, id: anyId(random, keys) };
    case 10:
      return {
        type: 'key.move',
        entity,
        id: anyId(random, keys),
        before: maybe(anyId(random, keys)),
      };
    case 11:
      return {
        type: 'subjectArea.create',
        name,
        entities: random.chance(0.5) ? [anyId(random, entityIds)] : [],
      };
    case 12:
      return {
        type: 'subjectArea.update',
        id: anyId(random, areas),
        set: { definition: name },
        unset: maybe(['order']),
      };
    case 13:
      return { type: 'subjectArea.delete', id: anyId(random, areas) };
    case 14:
      return {
        type: 'subjectArea.addEntities',
        id: anyId(random, areas),
        entities: [anyId(random, entityIds)],
      };
    default:
      return {
        type: 'subjectArea.removeEntities',
        id: anyId(random, areas),
        entities: [anyId(random, entityIds)],
      };
  }
}

/** A sub-command, or now and then a batch of a few. */
function command(random: Random, editor: Editor): object {
  if (!random.chance(0.15)) return subCommand(random, editor.model);
  const commands = [];
  for (let n = random.int(2, 4); n > 0; n -= 1) {
    commands.push(subCommand(random, editor.model));
  }
  return { type: 'batch', commands };
}

describe('명령 동작: 무작위', () => {
  test('a deep-frozen example under random commands of every kind, undo and redo: nothing throws, errors never grow', async () => {
    const model = deepFreeze(await exampleModel());
    const before = snapshotOf(model);
    const editor = createEditor(model);
    expect(errorCount(editor.issues)).toBe(0);
    const random = new Random(20261128);
    const seen = new Set<string>();
    let accepted = 0;
    for (let run = 0; run < RUNS; run += 1) {
      const roll = random.next();
      const result =
        roll < 0.1
          ? editor.undo()
          : roll < 0.15
            ? editor.redo()
            : editor.execute(command(random, editor));
      if (result.ok) accepted += 1;
      else seen.add(result.code);
      expect(
        result.ok || result.code !== 'internal',
        JSON.stringify(result),
      ).toBe(true);
      expect(errorCount(editor.issues)).toBe(0);
    }
    expect(snapshotOf(model)).toEqual(before);
    // The run reaches the refusals and enough successes to mean something.
    expect(accepted).toBeGreaterThan(RUNS / 4);
    for (const code of ['not-found', 'validation']) {
      expect(seen.has(code)).toBe(true);
    }
    // Undo as far as history goes, then each model is still whole.
    while (editor.canUndo) expect(editor.undo().ok).toBe(true);
    expect(errorCount(editor.issues)).toBe(0);
  });
});
