import { describe, test } from 'vitest';
import { expectLinearTime } from '../testing/timing.js';
import { serializeModel } from './serialize.js';
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

describe('serializeModel: time grows linearly', () => {
  const shapes: [string, (n: number) => Model, number][] = [
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
    ],
  ];

  test.each(shapes)(
    '%s: four times the size takes less than eight times as long',
    { timeout: 120_000 },
    async (_name, build, small) => {
      await expectLinearTime({
        sizes: [small, small * 4],
        input: build,
        run: serializeModel,
        maxRatio: 8,
        backstop: 20_000,
      });
    },
  );
});
