import { describe, expect, test } from 'vitest';
import { loadModel } from '../model/load.js';
import type { EntityData, Issue, Model } from '../model/types.js';
import { exampleFileSystem } from '../testing/example.js';
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

const schemaIssue = (
  file: string,
  path: string,
  message: string,
  position?: { line: number; column: number },
): Issue => ({
  rule: 'schema',
  severity: 'error',
  file,
  path,
  ...position,
  message,
});

/** Nested `depth` levels below `leaf`. */
function deep(depth: number, leaf: unknown = 'x'): unknown {
  let value = leaf;
  for (let i = 0; i < depth; i += 1) value = { a: [value] };
  return value;
}

describe('validateModel: schema and JSON values', () => {
  test('the example model read from the example has no issues', async () => {
    const { model, positions } = await loadModel(exampleFileSystem(), '');
    expect(validateModel(model, positions)).toEqual([]);
    expect(validateModel(model)).toEqual([]);
  });

  test('a model changed in memory: paths without positions, sorted by file, every list checked', async () => {
    const { model } = await loadModel(exampleFileSystem(), '');
    const changed: Model = {
      ...model,
      manifest: model.manifest && {
        ...model.manifest,
        data: { ...model.manifest.data, notation: 'x' as 'ie' },
      },
      entities: [
        entity('entities/z.yaml', { id: 'z', name: 'Z', attributes: null }),
        ...model.entities,
      ],
      layouts: [{ file: 'layouts/new.json', data: { nodes: {} } as never }],
      dictionaries: [{ file: 'd/a.yaml', data: { words: 1 } as never }],
    };
    expect(validateModel(changed)).toEqual([
      schemaIssue('d/a.yaml', '/words', '/words must be array'),
      schemaIssue(
        'entities/z.yaml',
        '/attributes',
        '/attributes must be array',
      ),
      schemaIssue(
        'layouts/new.json',
        '',
        "/ must have required property 'formatVersion'",
      ),
      schemaIssue(
        'model.yaml',
        '/notation',
        '/notation must be equal to one of the allowed values',
      ),
    ]);
    expect(model.entities).toHaveLength(10);
  });

  test('with positions, an item from disk gets the position of its path', async () => {
    const { model, positions } = await loadModel(exampleFileSystem(), '');
    const [first, ...rest] = model.entities;
    if (!first) throw new Error('no entity');
    const changed: Model = {
      ...model,
      entities: [
        { ...first, data: { ...first.data, name: 7 as unknown as string } },
        ...rest,
      ],
    };
    expect(validateModel(changed, positions)).toEqual([
      schemaIssue(first.file, '/name', '/name must be string', {
        line: 2,
        column: 1,
      }),
    ]);
  });

  test('values that are not JSON data are reported without throwing', () => {
    const cyclic: Record<string, unknown> = {
      id: 'c',
      name: 'C',
      attributes: [],
    };
    cyclic.ext = { self: cyclic };
    const model: Model = {
      ...emptyModel(),
      entities: [
        entity('a.yaml', {
          id: 'a',
          name: 'A',
          attributes: [],
          ext: { d: new Date(0) },
        }),
        entity('b.yaml', cyclic),
        entity('c.yaml', undefined),
        entity('d.yaml', () => 1),
      ],
    };
    expect(validateModel(model)).toEqual([
      schemaIssue('a.yaml', '/ext/d', '/ext/d must be a JSON value'),
      schemaIssue('b.yaml', '/ext/self', '/ext/self must be a JSON value'),
      schemaIssue('c.yaml', '', '/ must be a JSON value'),
      schemaIssue('d.yaml', '', '/ must be a JSON value'),
    ]);
  });

  test('data nested 100000 levels deep is checked without throwing', () => {
    const model: Model = {
      ...emptyModel(),
      entities: [
        entity('a.yaml', {
          id: 'a',
          name: 'A',
          attributes: [{ id: 'x', name: 'X', default: deep(100_000) }],
          ext: { d: deep(100_000) },
        }),
      ],
      subjectAreas: [
        {
          file: 'b.yaml',
          data: {
            id: 'b',
            name: 'B',
            entities: [deep(100_000), deep(100_000)],
          } as never,
        },
      ],
    };
    const messages = validateModel(model).map((found) => found.message);
    expect(messages).toContain(
      '/entities must NOT have duplicate items (items ## 0 and 1 are identical)',
    );
    expect(messages).toContain(
      '/attributes/0/default must match exactly one schema in oneOf',
    );
  });

  test('does not change the model', async () => {
    const { model } = await loadModel(exampleFileSystem(), '');
    const before = JSON.stringify(model);
    validateModel(model);
    expect(JSON.stringify(model)).toBe(before);
  });

  test(
    'many entities with many attributes are checked in linear time',
    { timeout: 60_000 },
    () => {
      // Four times the items take about four times as long if linear, sixteen if quadratic.
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
      const time = (model: Model, expected: number) => {
        let best = Infinity;
        for (let run = 0; run < 3; run += 1) {
          const start = performance.now();
          const issues = validateModel(model);
          best = Math.min(best, performance.now() - start);
          expect(issues).toHaveLength(expected);
        }
        return best;
      };
      validateModel(build(1, 1));
      for (const [small, large] of [
        [build(2_500, 4), build(10_000, 4)],
        [build(1, 10_000), build(1, 40_000)],
      ] as const) {
        const count = (model: Model) =>
          model.entities.reduce(
            (sum, item) => sum + item.data.attributes.length,
            0,
          );
        const smallTime = time(small, count(small));
        const largeTime = time(large, count(large));
        expect(largeTime / smallTime).toBeLessThan(8);
        expect(largeTime).toBeLessThan(10_000);
      }
    },
  );
});
