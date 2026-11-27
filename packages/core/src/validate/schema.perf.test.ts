import { describe, expect, test } from 'vitest';
import { expectLinearTime } from '../testing/timing.js';
import { schemaIssues } from './schema.js';

const FILE = 'subject-areas/party.yaml';

describe('schema issues: duplicate items', () => {
  test(
    'a subject area of many entities is checked in linear time',
    { timeout: 120_000 },
    async () => {
      await expectLinearTime({
        sizes: [10_000, 40_000],
        input: (count) => ({
          id: 'p',
          name: 'P',
          entities: Array.from({ length: count }, (_, i) => `e${i}`),
        }),
        run: (data) => schemaIssues(FILE, 'subject-area', data),
        check: (issues) => expect(issues).toEqual([]),
        maxRatio: 8,
        backstop: 10_000,
      });
    },
  );
});
