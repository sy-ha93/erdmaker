import { describe, expect, test } from 'vitest';
import { expectLinearTime } from '../testing/timing.js';
import { parseYaml } from './yaml.js';

const FILE = 'entities/order.yaml';

describe('YAML with many keys', () => {
  /** Reading `text(10000)` and `text(40000)`: the time ratio stays below 8, the large one below 10 s. */
  const expectLinear = (
    text: (count: number) => string,
    check: (result: ReturnType<typeof parseYaml>, count: number) => void,
  ) =>
    expectLinearTime({
      sizes: [10_000, 40_000],
      input: (count) => text(count),
      run: (source) => parseYaml(FILE, source),
      check,
      maxRatio: 8,
      backstop: 10_000,
    });

  test(
    'a block map of distinct keys is read in linear time',
    { timeout: 120_000 },
    async () => {
      await expectLinear(
        (count) =>
          Array.from({ length: count }, (_, i) => `k${i}: ${i}\n`).join(''),
        (result, count) => {
          expect(result.issues).toEqual([]);
          expect(Object.keys(result.value as object)).toHaveLength(count);
        },
      );
    },
  );

  test(
    'a one-line flow map with a duplicate key is read in linear time',
    { timeout: 120_000 },
    async () => {
      const text = (count: number) =>
        `{${Array.from({ length: count }, (_, i) => `k${i}: ${i}`).join(', ')}, k0: x}`;
      await expectLinear(text, (result, count) => {
        const column = text(count).lastIndexOf('k0:') + 1;
        expect(result.issues).toEqual([
          {
            rule: 'syntax',
            severity: 'error',
            file: FILE,
            path: '',
            line: 1,
            column,
            message: `Map keys must be unique at line 1, column ${column}:`,
          },
        ]);
        expect(result.value).toBeUndefined();
      });
    },
  );
});
