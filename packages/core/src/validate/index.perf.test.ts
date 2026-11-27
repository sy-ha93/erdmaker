import { describe, expect, test } from 'vitest';
import type { EntityData, Model } from '../model/types.js';
import { MAX_NESTING } from '../parse/yaml.js';
import { expectLinearTime } from '../testing/timing.js';
import { validateModel } from './index.js';

const emptyModel = (): Model => ({
  dir: '',
  entities: [],
  relationships: [],
  subtypes: [],
  subjectAreas: [],
  layouts: [],
  dictionaries: [],
});

const entity = (file: string, data: unknown) => ({
  file,
  data: data as EntityData,
});

describe('validateModel: schema and JSON values', () => {
  test(
    'many entities with many attributes are checked in linear time',
    { timeout: 120_000 },
    async () => {
      const build = (entities: number, attributes: number): Model => ({
        ...emptyModel(),
        entities: Array.from({ length: entities }, (_, e) =>
          entity(`entities/e${e}.yaml`, {
            id: `e${e}`,
            name: `E${e}`,
            attributes: Array.from({ length: attributes }, (_, a) => ({
              id: `a${a}`,
              name: `A${a}`,
              bogus: 1,
            })),
            keys: [
              {
                id: 'pk',
                kind: 'primary',
                attributes: Array.from(
                  { length: attributes },
                  (_, a) => `a${a}`,
                ),
              },
            ],
          }),
        ),
        subjectAreas: [
          {
            file: 'subject-areas/all.yaml',
            data: {
              id: 'all',
              name: 'All',
              entities: Array.from({ length: entities }, (_, e) => `e${e}`),
            },
          },
        ],
      });
      const count = (model: Model) =>
        model.entities.reduce(
          (sum, item) => sum + item.data.attributes.length,
          0,
        );
      // A schema error per attribute; then, those entities left out, R02 for each in the area.
      const expected = (model: Model) => count(model) + model.entities.length;
      // Many entities of four attributes; one entity of many attributes.
      for (const [shape, small] of [
        [(n: number) => build(n, 4), 2_500],
        [(n: number) => build(1, n), 10_000],
      ] as const) {
        await expectLinearTime({
          sizes: [small, small * 4],
          input: shape,
          run: (model) => ({ model, issues: validateModel(model) }),
          check: ({ model, issues }) =>
            expect(issues).toHaveLength(expected(model)),
          maxRatio: 8,
          backstop: 10_000,
        });
      }
    },
  );
});

describe('validateModel: data nested deeper than a file may hold', () => {
  test(
    'deep data is checked in linear time',
    { timeout: 120_000 },
    async () => {
      /** An entity whose `ext` holds `levels` arrays, each the only item of the one around it. */
      const deepModel = (levels: number): Model => {
        let value: unknown[] = [];
        for (let level = 1; level < levels; level += 1) value = [value];
        return {
          ...emptyModel(),
          entities: [
            entity('entities/e.yaml', {
              id: 'e',
              name: 'E',
              attributes: [],
              ext: { k: value },
            }),
          ],
        };
      };
      const path = `/ext/k${'/0'.repeat(MAX_NESTING - 2)}`;
      const measure = (sizes: readonly [number, number]) =>
        expectLinearTime({
          sizes,
          input: deepModel,
          run: validateModel,
          check: (issues) =>
            expect(issues).toEqual([
              {
                rule: 'schema',
                severity: 'error',
                file: 'entities/e.yaml',
                path,
                message: `${path} is nested more than ${MAX_NESTING} levels deep`,
              },
            ]),
          maxRatio: 8,
          backstop: 10_000,
        });
      // Small sizes first: a quadratic walk fails here in seconds, whereas at
      // the large sizes it would hang, as Vitest's timeout cannot interrupt
      // synchronous code.
      await measure([5_000, 20_000]);
      await measure([50_000, 200_000]);
    },
  );
});
