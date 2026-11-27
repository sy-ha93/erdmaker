import { describe, expect, test } from 'vitest';
import { expectLinearTime } from '../testing/timing.js';
import { type SerializedFile, serializeModel } from './serialize.js';
import type { Model } from './types.js';

/** A model holding only the given items. */
function model(partial: Partial<Model>): Model {
  return {
    dir: '',
    entities: [],
    relationships: [],
    subtypes: [],
    subjectAreas: [],
    layouts: [],
    dictionaries: [],
    ...partial,
  };
}

const entity = (data: Record<string, unknown>, file = 'entities/e.yaml') =>
  model({ entities: [{ file, data: data as never }] });

/** How often `part` occurs in the text of the only file. */
const count = (files: SerializedFile[], part: string) => {
  expect(files).toHaveLength(1);
  return files[0]!.text.split(part).length - 1;
};

describe('serializeModel: time grows linearly', () => {
  /** The model of a size, the small size, and what the output of a size holds. */
  const shapes: [
    string,
    (n: number) => Model,
    number,
    (files: SerializedFile[], n: number) => void,
  ][] = [
    [
      'entities',
      (n) =>
        model({
          entities: Array.from({ length: n }, (_, e) => ({
            file: `entities/e${e}.yaml`,
            data: {
              id: `e${e}`,
              name: `Entity ${e}`,
              attributes: [
                {
                  id: 'a',
                  name: 'A',
                  nullable: true,
                  type: { length: 9, base: 'string' },
                },
                { id: 'b', name: 'B', note: 'two\nlines\n\n' },
              ],
            },
          })),
        }),
      5_000,
      (files, n) => {
        expect(files).toHaveLength(n);
        expect(files[n - 1]?.text).toContain('    note: "two\\nlines\\n\\n"\n');
      },
    ],
    [
      'attributes of one entity',
      (n) =>
        entity({
          id: 'e',
          name: 'E',
          attributes: Array.from({ length: n }, (_, a) => ({
            name: `Attribute ${a}`,
            id: `a${a}`,
            migratedFrom: [{ attribute: 'x', relationship: 'r' }],
            rolenamed: false,
          })),
        }),
      10_000,
      (files, n) => expect(count(files, '\n  - id: a')).toBe(n),
    ],
    [
      'nodes of a layout',
      (n) =>
        model({
          layouts: [
            {
              file: 'layouts/l.json',
              data: {
                formatVersion: '0.1',
                nodes: Object.fromEntries(
                  Array.from({ length: n }, (_, i) => [
                    String(n - i),
                    { y: i, x: -i },
                  ]),
                ),
                edges: Object.fromEntries(
                  Array.from({ length: n / 4 }, (_, i) => [
                    `r${i}`,
                    { waypoints: [{ x: i, y: i }] },
                  ]),
                ),
              },
            },
          ],
        }),
      10_000,
      // One per node and one per edge's waypoint.
      (files, n) => expect(count(files, '{ "x": ')).toBe(n + n / 4),
    ],
    [
      'words of a dictionary',
      (n) =>
        model({
          dictionaries: [
            {
              file: 'dictionary/d.yaml',
              data: {
                words: Array.from({ length: n }, (_, w) => ({
                  id: `w${w}`,
                  name: `word ${w}`,
                  abbreviation: w % 2 ? 'NO' : 'yes',
                  classifier: false,
                })),
              },
            },
          ],
        }),
      10_000,
      (files, n) => {
        expect(count(files, '\n  - id: w')).toBe(n);
        expect(count(files, 'abbreviation: "NO"')).toBe(n / 2);
      },
    ],
    [
      'a text of many line ends and one letter',
      (n) =>
        entity({
          id: 'e',
          name: 'E',
          note: `${'\n'.repeat(n)}x`,
          attributes: [],
        }),
      10_000,
      // A block scalar: a line per line end, and five lines around them.
      (files, n) => expect(count(files, '\n')).toBe(n + 5),
    ],
  ];

  test.each(shapes)(
    '%s: four times the size takes less than eight times as long',
    { timeout: 120_000 },
    async (_name, build, small, check) => {
      await expectLinearTime({
        sizes: [small, small * 4],
        input: build,
        run: serializeModel,
        check,
        maxRatio: 8,
        backstop: 20_000,
      });
    },
  );
});
