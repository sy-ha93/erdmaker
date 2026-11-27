import { describe, expect, test } from 'vitest';
import { createMemoryFileSystem } from '../fs/memory.js';
import { exampleFiles, replaceOnce } from '../testing/example.js';
import { expectLinearTime } from '../testing/timing.js';
import { loadModel } from './load.js';

describe('loadModel: dictionary folders', () => {
  test(
    'many names for one folder holding many files: each file listed and read once',
    { timeout: 120_000 },
    async () => {
      // `n` different entries that all name `dictionary`, which holds `n` more files.
      const files = (n: number) => {
        const aliases = Array.from(
          { length: n },
          (_, i) => `  - a${i}/../dictionary\n`,
        ).join('');
        const out = replaceOnce(
          exampleFiles(),
          'model.yaml',
          'targets:\n',
          `dictionaries:\n${aliases}targets:\n`,
        );
        for (let i = 0; i < n; i += 1)
          out[`dictionary/d${i}.yaml`] = 'words: []\n';
        return out;
      };
      await expectLinearTime({
        sizes: [500, 2_000],
        input: (n) => createMemoryFileSystem(files(n)),
        run: (fs) => loadModel(fs, ''),
        check: ({ model, issues }, n) => {
          expect(issues).toEqual([]);
          expect(model.dictionaries).toHaveLength(n + 1);
        },
        maxRatio: 8,
        backstop: 20_000,
      });
    },
  );
});
