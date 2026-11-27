import { describe, expect, test } from 'vitest';
import { expectLinearTime } from '../testing/timing.js';
import { parseJson } from './json.js';

const FILE = 'layouts/sales.json';

describe('layout JSON with many keys', () => {
  /** Reading `text(10000)` and `text(40000)`: the time ratio stays below 8, the large one below 10 s. */
  const expectLinear = (
    text: (count: number) => string,
    check: (result: ReturnType<typeof parseJson>, count: number) => void,
  ) =>
    expectLinearTime({
      sizes: [10_000, 40_000],
      input: (count) => text(count),
      run: (source) => parseJson(FILE, source),
      check,
      maxRatio: 8,
      backstop: 10_000,
    });

  /** Minified JSON of `count` distinct keys. */
  const minified = (count: number) =>
    JSON.stringify(
      Object.fromEntries(Array.from({ length: count }, (_, i) => [`k${i}`, i])),
    );

  test(
    'a minified object of distinct keys is read in linear time',
    { timeout: 120_000 },
    async () => {
      await expectLinear(minified, (result, count) => {
        expect(result.issues).toEqual([]);
        expect(result.positions.size).toBe(count);
      });
    },
  );

  test(
    'truncated minified JSON with a duplicate key and no engine position is read in linear time',
    { timeout: 120_000 },
    async () => {
      const text = (count: number) => `${minified(count).slice(0, -1)},"k0":`;
      await expectLinear(text, (result, count) => {
        expect(result.value).toBeUndefined();
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0]).toMatchObject({
          rule: 'syntax',
          line: 1,
          column: text(count).lastIndexOf('"k0"') + 1,
          message: 'Unexpected end of JSON input',
        });
      });
    },
  );
});
