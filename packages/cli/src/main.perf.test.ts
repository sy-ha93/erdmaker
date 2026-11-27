import type { ModelResult, ProjectResult } from '@erdmaker/core';
import { describe, expect, test } from 'vitest';
import { expectLinearTime } from '../../core/src/testing/timing.js';
import { okLines } from './main.js';

const COUNTS: ModelResult['counts'] = {
  entities: 1,
  relationships: 0,
  subtypes: 0,
  subjectAreas: 0,
  layouts: 0,
  words: 0,
  terms: 0,
  domains: 0,
};

describe('validate: OK lines', () => {
  test(
    'many models sharing an id: each project issue is matched to its model once',
    { timeout: 120_000 },
    async () => {
      // `n` models with one id give `n` P01 issues, and `n` more models are clean.
      const project = (n: number): ProjectResult => ({
        issues: Array.from({ length: n }, (_, i) => ({
          rule: 'P01',
          severity: 'error',
          file: `same/m${i}/model.yaml`,
          path: '/id',
          message: `duplicate model id "m" (also in same/m${i ? 0 : 1}/model.yaml)`,
        })),
        models: [
          ...Array.from({ length: n }, (_, i) => ({
            dir: `same/m${i}`,
            issues: [],
            counts: COUNTS,
          })),
          ...Array.from({ length: n }, (_, i) => ({
            dir: `clean/m${i}`,
            issues: [],
            counts: COUNTS,
          })),
        ],
      });
      await expectLinearTime({
        sizes: [5_000, 20_000],
        input: project,
        run: okLines,
        check: (lines, n) => {
          expect(lines).toHaveLength(n);
          expect(lines[n - 1]).toBe(
            `clean/m${n - 1}: OK: 1 entities, 0 relationships, 0 subtype clusters, 0 subject areas, 0 layouts, 0 words, 0 terms, 0 domains`,
          );
        },
        maxRatio: 8,
        backstop: 20_000,
      });
    },
  );
});
