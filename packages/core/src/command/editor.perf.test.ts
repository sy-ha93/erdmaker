import { describe, expect, test } from 'vitest';
import { wideModel } from '../testing/wide-model.js';
import { createEditor } from './editor.js';

const LIMIT_MS = 250;
const RUNS = 5;

describe('편집기: 시간', () => {
  test(
    'one attribute.update on 1000 entities of 15 attributes takes under 250 ms',
    { timeout: 60_000 },
    async ({ annotate }) => {
      const editor = createEditor(wideModel(1000, 15));
      expect(editor.issues).toEqual([]);
      expect(editor.model.entities).toHaveLength(1000);

      // Two values in turn: every run changes the model, and nothing needs undoing between runs.
      const commands = ['첫 값', '둘째 값'].map((definition) => ({
        type: 'attribute.update',
        entity: 'e500',
        id: 'a7',
        set: { definition },
      }));
      const run = (index: number): number => {
        const command = commands[index % 2]!;
        const before = editor.model;
        const start = performance.now();
        const result = editor.execute(command);
        const elapsed = performance.now() - start;
        expect(result.ok).toBe(true);
        expect(result.ok && result.model).not.toBe(before);
        expect(editor.model).not.toBe(before);
        return elapsed;
      };

      run(0);
      const times: number[] = [];
      for (let index = 1; index <= RUNS; index += 1) times.push(run(index));
      const best = Math.min(...times);
      await annotate(`times: ${times.map((t) => t.toFixed(1)).join(', ')} ms`);
      expect(
        best,
        `best of ${RUNS} runs: ${times.map((t) => t.toFixed(1)).join(', ')} ms`,
      ).toBeLessThan(LIMIT_MS);
    },
  );
});
