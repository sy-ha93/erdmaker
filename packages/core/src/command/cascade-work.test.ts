import { describe, expect, test, vi } from 'vitest';
import type { KeyData, LayoutData } from '../model/types.js';
import { areaItem, entityItem, handModel } from '../testing/editing.js';
import { createEditor } from './editor.js';
import { noteWork, type WorkKind } from './work.js';

vi.mock('./work.js', () => ({ noteWork: vi.fn() }));

/** The cells the working state reported since the last call, by kind. */
function takeWork(): Record<WorkKind | 'calls', number> & {
  builds: number[];
} {
  const work = { copy: 0, scan: 0, 'index-build': 0, calls: 0 };
  const builds: number[] = [];
  for (const [kind, entries] of vi.mocked(noteWork).mock.calls) {
    work[kind] += entries;
    work.calls += 1;
    if (kind === 'index-build') builds.push(entries);
  }
  vi.mocked(noteWork).mockClear();
  return { ...work, builds };
}

const total = (work: ReturnType<typeof takeWork>) =>
  work.copy + work.scan + work['index-build'];

const SIZES = [250, 500, 1000] as const;

/** `|Δ500 − 2·Δ250|` and `Δ500` of three counts (plan decision 9). */
function steps([a, b, c]: number[]): { bend: number; d500: number } {
  return { bend: Math.abs(c! - b! - 2 * (b! - a!)), d500: c! - b! };
}

/** A layout of the subject area `area` with nodes for `ids`. */
const layout = (file: string, area: string, ids: string[] = []) => {
  const nodes: LayoutData['nodes'] = {};
  for (const [i, id] of ids.entries()) nodes[id] = { x: i, y: 0 };
  return {
    file,
    data: {
      formatVersion: '0.1' as const,
      subjectArea: area,
      nodes,
      edges: {},
    },
  };
};

describe('연쇄와 대상: 일의 수', () => {
  test('attribute.delete compacts the keys once, however many keys it empties', () => {
    // 2n inversion keys: the first n hold only `a`, the rest only `b`.
    const work: number[] = [];
    for (const n of SIZES) {
      const keys: KeyData[] = [];
      for (let i = 0; i < 2 * n; i += 1) {
        keys.push({
          id: `k${i}`,
          kind: 'inversion',
          attributes: [i < n ? 'a' : 'b'],
        });
      }
      const entity = entityItem('x', {
        attributes: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
        keys,
      });
      const editor = createEditor(handModel({ entities: [entity] }));
      expect(editor.issues).toEqual([]);
      takeWork();
      const result = editor.execute({
        type: 'attribute.delete',
        entity: 'x',
        id: 'a',
      });
      expect(result.ok).toBe(true);
      const left = editor.model.entities[0]!.data.keys!;
      expect(left).toHaveLength(n);
      expect(left[0]).toBe(keys[n]);
      expect(left[n - 1]).toBe(keys[2 * n - 1]);
      const done = takeWork();
      // Measured at all: the one pass over the 2n keys is counted.
      expect(done.scan).toBeGreaterThanOrEqual(2 * n);
      work.push(total(done));
    }
    // Before, each emptied key shifted the keys after it: about n² moves.
    const { bend, d500 } = steps(work);
    expect(bend).toBeLessThanOrEqual(2);
    expect(d500).toBeLessThanOrEqual(500 * 12);
  });

  test('attribute.delete leaves keys that do not hold the attribute, and an entity without keys, alone', () => {
    const keys: KeyData[] = [
      { id: 'pk', kind: 'primary', attributes: ['b'] },
      { id: 'ie', kind: 'inversion', attributes: ['a', 'b'] },
      { id: 'ak', kind: 'alternate', attributes: ['a'] },
    ];
    const attributes = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ];
    const model = handModel({
      entities: [
        entityItem('x', { attributes, keys }),
        entityItem('y', { attributes }),
      ],
    });
    const editor = createEditor(model);
    expect(
      editor.execute({ type: 'attribute.delete', entity: 'x', id: 'a' }).ok,
    ).toBe(true);
    const after = editor.model.entities[0]!.data.keys!;
    expect(after).toEqual([
      { id: 'pk', kind: 'primary', attributes: ['b'] },
      { id: 'ie', kind: 'inversion', attributes: ['b'] },
    ]);
    expect(after[0]).toBe(keys[0]);
    expect(keys[1]!.attributes).toEqual(['a', 'b']);
    expect(
      editor.execute({ type: 'attribute.delete', entity: 'y', id: 'a' }).ok,
    ).toBe(true);
    expect('keys' in editor.model.entities[1]!.data).toBe(false);
  });

  test('subjectArea.removeEntities: the work is linear in the ids named', () => {
    // n entities in `all`, besides ten that have nodes in its one layout;
    // all n are taken out and none has a node.
    const fixed = Array.from({ length: 10 }, (_, i) => `f${i}`);
    const work: number[] = [];
    for (const n of SIZES) {
      const ids: string[] = [];
      for (let i = 0; i < n; i += 1) ids.push(`e${i}`);
      const all = [...fixed, ...ids];
      const editor = createEditor(
        handModel({
          entities: all.map((id) => entityItem(id)),
          subjectAreas: [areaItem('all', [...all])],
          layouts: [layout('layouts/all.json', 'all', fixed)],
        }),
      );
      expect(editor.issues).toEqual([]);
      takeWork();
      const result = editor.execute({
        type: 'subjectArea.removeEntities',
        id: 'all',
        entities: ids,
      });
      expect(result.ok).toBe(true);
      expect(editor.model.subjectAreas[0]!.data.entities).toEqual(fixed);
      const done = takeWork();
      // Measured at all: the area's list and each id in the layout.
      expect(done.scan).toBeGreaterThanOrEqual(2 * n);
      work.push(total(done));
    }
    const { bend, d500 } = steps(work);
    expect(bend).toBeLessThanOrEqual(2);
    expect(d500).toBeLessThanOrEqual(500 * 12);
  });

  test("subjectArea.removeEntities: an id is probed in the area's layout, whatever its node count", () => {
    // Codex: one absent id in an area with a 4000-node layout walked all
    // 4000 nodes. Each id named is looked up with one own-property probe
    // per layout of the area (ids × those layouts).
    const work: number[] = [];
    for (const n of [...SIZES, 4000]) {
      const nodes: string[] = [];
      for (let i = 0; i < n; i += 1) nodes.push(`e${i}`);
      const layoutItem = layout('layouts/small.json', 'small', nodes);
      const editor = createEditor(
        handModel({
          entities: [...nodes, 'a'].map((id) => entityItem(id)),
          // The nodes are of entities outside the area (R09): the
          // area's own list stays one id long.
          subjectAreas: [areaItem('small', ['a'])],
          layouts: [layoutItem],
        }),
      );
      takeWork();
      const result = editor.execute({
        type: 'subjectArea.removeEntities',
        id: 'small',
        entities: ['a'],
      });
      expect(result.ok).toBe(true);
      // `a` has no node: the layout stays the object it was.
      expect(editor.model.layouts[0]).toBe(layoutItem);
      const done = takeWork();
      // Measured at all: the area's list, the layouts and the one id.
      expect(done.scan).toBeGreaterThanOrEqual(3);
      work.push(total(done));
    }
    expect(new Set(work).size).toBe(1);
  });
});

describe('묶음: 같은 대상을 거듭 고치는 일의 수', () => {
  // FR-10: n sub-commands that each edit the same item cost n × its size.
  // These pin "at most one pass over the item per sub-command".

  test('n inserts before one anchor: one member index build per insert', () => {
    for (const n of SIZES) {
      const editor = createEditor(
        handModel({
          entities: [
            entityItem('x', { attributes: [{ id: 'end', name: 'End' }] }),
          ],
        }),
      );
      const commands = [];
      for (let i = 0; i < n; i += 1) {
        commands.push({
          type: 'attribute.create',
          entity: 'x',
          id: `a${i}`,
          name: 'A',
          before: 'end',
        });
      }
      takeWork();
      const result = editor.execute({ type: 'batch', commands });
      expect(result.ok).toBe(true);
      expect(editor.model.entities[0]!.data.attributes).toHaveLength(n + 1);
      const work = takeWork();
      // The insert i looks at an entity of i + 1 attributes: one pass is
      // the sum of those sizes.
      const pass = (n * (n + 1)) / 2 + n;
      const memberBuilds = work.builds.filter((entries) => entries > 1);
      // Measured at all: each insert but the first rebuilds the index.
      expect(memberBuilds.length).toBeGreaterThanOrEqual(n - 1);
      expect(work['index-build']).toBeGreaterThanOrEqual((n * (n + 1)) / 2);
      expect(memberBuilds.length).toBeLessThanOrEqual(n);
      expect(work['index-build']).toBeLessThanOrEqual(pass + 2);
      expect(total(work)).toBeLessThanOrEqual(pass + 10 * n);
    }
  });

  test('n single removals from one subject area: one pass over its list per removal', () => {
    for (const n of SIZES) {
      const ids: string[] = [];
      for (let i = 0; i < n; i += 1) ids.push(`e${i}`);
      const editor = createEditor(
        handModel({
          entities: ids.map((id) => entityItem(id)),
          subjectAreas: [areaItem('all', [...ids])],
        }),
      );
      const commands = ids.map((id) => ({
        type: 'subjectArea.removeEntities',
        id: 'all',
        entities: [id],
      }));
      takeWork();
      const result = editor.execute({ type: 'batch', commands });
      expect(result.ok).toBe(true);
      expect(editor.model.subjectAreas[0]!.data.entities).toEqual([]);
      const work = takeWork();
      // The removal i scans a list of n − i ids.
      const pass = (n * (n + 1)) / 2;
      // Measured at all: each removal scans what is left of the list.
      expect(work.scan).toBeGreaterThanOrEqual(pass);
      expect(work.scan).toBeLessThanOrEqual(pass + 2 * n);
      expect(total(work)).toBeLessThanOrEqual(pass + 10 * n);
    }
  });
});
