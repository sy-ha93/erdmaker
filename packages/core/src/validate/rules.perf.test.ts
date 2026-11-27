import { describe, expect, test } from 'vitest';
import { bigModel, brokenCount, type Sizes } from '../testing/big-model.js';
import { expectLinearTime } from '../testing/timing.js';
import { ruleIssues, type RuleItems } from './rules/index.js';

describe('규칙 사례: time', () => {
  test.each<[string, (n: number) => Sizes]>([
    [
      'an entity with many attributes and a key of all of them',
      (n) => ({ wide: n, many: 0, terms: 0 }),
    ],
    [
      'many relationships, subtype members, layout nodes and area entities',
      (n) => ({ wide: 0, many: n, terms: 0 }),
    ],
    ['many words and terms', (n) => ({ wide: n, many: 0, terms: n })],
  ])(
    'the rules take linear time: %s',
    { timeout: 240_000 },
    async (_name, sizes) => {
      // The rules alone, so that the schema check does not hide their growth.
      for (const broken of [false, true]) {
        await expectLinearTime({
          sizes: [5_000, 20_000],
          input: (n): RuleItems => ({ ...bigModel(sizes(n), broken) }),
          run: (items) => ruleIssues(items, ''),
          check: (issues, n) =>
            expect(issues).toHaveLength(broken ? brokenCount(sizes(n)) : 0),
          maxRatio: 8,
          backstop: 20_000,
        });
      }
    },
  );
});
