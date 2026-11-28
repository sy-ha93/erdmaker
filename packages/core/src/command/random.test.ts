import { describe, expect, test } from 'vitest';
import { serializeModel } from '../model/serialize.js';
import { serializeItem } from '../model/serialize-item.js';
import type { ReadonlyModel } from '../model/types.js';
import { deepFreeze, exampleModel, snapshotOf } from '../testing/editing.js';
import { Random } from '../testing/generate.js';
import { createEditor } from './editor.js';
import { errorCount } from './changes.js';
import type { CommandResult, Editor } from './types.js';

const RUNS = 2500;

/** The steps the editor keeps (spec FR-08). */
const HISTORY = 100;

const LISTS = [
  ['entities', 'entity'],
  ['relationships', 'relationship'],
  ['subtypes', 'subtype'],
  ['subjectAreas', 'subject-area'],
  ['layouts', 'layout'],
  ['dictionaries', 'dictionary'],
] as const;

/**
 * Serializes the items of `model` that `previous` does not hold: what
 * `serializeModel(model)` adds to the work of `serializeModel(previous)`.
 * Throws when it would.
 */
function serializeNewItems(previous: ReadonlyModel, model: ReadonlyModel) {
  for (const [list, schema] of LISTS) {
    const old = new Set<object>(previous[list]);
    for (const item of model[list]) {
      if (!old.has(item)) serializeItem(item.file, item.data, schema);
    }
  }
}

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
        set: {
          note: name,
          ...(random.chance(0.3) ? { scope: 'both' } : {}),
          // A number outside the safe integers: the input copy refuses it.
          ...(random.chance(0.1) ? { ext: { wide: 2 ** 53 } } : {}),
        },
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

/** A model with its issues, as the history holds them. */
interface Snapshot {
  model: ReadonlyModel;
  issues: Editor['issues'];
}

/**
 * The history the editor should have (spec FR-08), kept beside it: each
 * step checks the editor against it by identity. After each command that
 * changed the model, `undo` must give back the previous objects and `redo`
 * the new ones.
 */
class Mirror {
  past: Snapshot[] = [];
  future: Snapshot[] = [];
  current: Snapshot;

  constructor(private readonly editor: Editor) {
    this.current = { model: editor.model, issues: editor.issues };
  }

  /** The editor is on `snapshot`, and so is the result. */
  private expectOn(result: CommandResult, snapshot: Snapshot): void {
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    expect(result.model).toBe(snapshot.model);
    expect(result.issues).toBe(snapshot.issues);
    expect(this.editor.model).toBe(snapshot.model);
    expect(this.editor.issues).toBe(snapshot.issues);
  }

  execute(command: object): CommandResult {
    const editor = this.editor;
    const { canUndo, canRedo } = editor;
    const result = editor.execute(command);
    if (!result.ok || result.model === this.current.model) {
      // Refused, or nothing changed: the editor and its history stay.
      if (result.ok) expect(result.issues).toBe(this.current.issues);
      expect(editor.model).toBe(this.current.model);
      expect(editor.issues).toBe(this.current.issues);
      expect([editor.canUndo, editor.canRedo]).toEqual([canUndo, canRedo]);
      return result;
    }
    const previous = this.current;
    const next = { model: result.model, issues: result.issues };
    this.expectOn(result, next);
    this.past.push(previous);
    if (this.past.length > HISTORY) this.past.shift();
    this.future = [];
    this.current = next;
    this.expectOn(editor.undo(), previous);
    this.expectOn(editor.redo(), next);
    expect(editor.canRedo).toBe(false);
    return result;
  }

  undo(): CommandResult {
    const result = this.editor.undo();
    const back = this.past.pop();
    if (!back) {
      expect(result).toMatchObject({ ok: false, code: 'nothing-to-undo' });
      return result;
    }
    this.future.push(this.current);
    this.current = back;
    this.expectOn(result, back);
    return result;
  }

  redo(): CommandResult {
    const result = this.editor.redo();
    const ahead = this.future.pop();
    if (!ahead) {
      expect(result).toMatchObject({ ok: false, code: 'nothing-to-redo' });
      return result;
    }
    this.past.push(this.current);
    this.current = ahead;
    this.expectOn(result, ahead);
    return result;
  }

  /** Undoes as far as history goes, each step by identity. */
  undoAll(): void {
    while (this.past.length > 0) this.undo();
    expect(this.editor.canUndo).toBe(false);
  }
}

/** `runs` random steps: commands, and now and then an undo or a redo. */
function walk(
  random: Random,
  mirror: Mirror,
  editor: Editor,
  runs: number,
  check: (run: number) => void = () => {},
): { accepted: number; seen: Set<string> } {
  const seen = new Set<string>();
  let accepted = 0;
  for (let run = 0; run < runs; run += 1) {
    const roll = random.next();
    const before = editor.model;
    const result =
      roll < 0.1
        ? mirror.undo()
        : roll < 0.15
          ? mirror.redo()
          : mirror.execute(command(random, editor));
    if (result.ok) accepted += 1;
    else seen.add(result.code);
    // The walk starts with no error: every model it reaches can be saved.
    // The items it shares with the model before were serialized already, so
    // each step serializes the new ones, and now and then the whole model.
    if (result.ok && result.model !== before) {
      expect(() => serializeNewItems(before, editor.model)).not.toThrow();
    }
    if (run % 100 === 0) {
      expect(() => serializeModel(editor.model)).not.toThrow();
    }
    expect(
      result.ok || result.code !== 'internal',
      JSON.stringify(result),
    ).toBe(true);
    expect(errorCount(editor.issues)).toBe(0);
    check(run);
  }
  return { accepted, seen };
}

describe('명령 동작: 무작위', () => {
  test('a deep-frozen example under random commands of every kind, undo and redo: nothing throws, errors never grow, every model serializes, history by identity', async () => {
    const model = deepFreeze(await exampleModel());
    const before = snapshotOf(model);
    const editor = createEditor(model);
    const start = { model: editor.model, issues: editor.issues };
    expect(errorCount(editor.issues)).toBe(0);
    const random = new Random(20261128);

    // Fewer changes than the history holds: undoing all reaches the start.
    const first = new Mirror(editor);
    walk(random, first, editor, 60);
    expect(first.past.length).toBeLessThan(HISTORY);
    first.undoAll();
    expect(editor.model).toBe(model);
    expect(editor.issues).toBe(start.issues);

    // A long run, the start model checked against its snapshot as it goes.
    const mirror = new Mirror(editor);
    const { accepted, seen } = walk(random, mirror, editor, RUNS, (run) => {
      if (run % 500 === 0) expect(snapshotOf(model)).toEqual(before);
    });
    expect(snapshotOf(model)).toEqual(before);
    // The run reaches the refusals and enough successes to mean something.
    expect(accepted).toBeGreaterThan(RUNS / 4);
    for (const code of ['not-found', 'validation']) {
      expect(seen.has(code)).toBe(true);
    }
    // Undo as far as history goes: each step by identity, and the bottom is
    // the model the mirror saw there.
    const bottom = mirror.past[0]!;
    mirror.undoAll();
    expect(editor.model).toBe(bottom.model);
    expect(errorCount(editor.issues)).toBe(0);
    expect(snapshotOf(model)).toEqual(before);
  });
});
