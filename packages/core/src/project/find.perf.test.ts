import { describe, expect, test } from 'vitest';
import type { FileEntry, FileSystemAdapter } from '../fs/adapter.js';
import { expectLinearTime } from '../testing/timing.js';
import { findModels } from './find.js';
import { type ModelId, modelIdIssues } from './validate.js';

/**
 * A read-only adapter over a fixed folder tree whose `list` costs nothing
 * but its answer. The memory adapter scans every stored path per `list`
 * (spec 8), which would time the adapter, not the search.
 */
function treeFileSystem(folders: Map<string, FileEntry[]>): FileSystemAdapter {
  const never = () => Promise.reject(new Error('not in this test'));
  return {
    readText: never,
    writeText: never,
    remove: never,
    list: async (dir) => folders.get(dir) ?? [],
  };
}

const MODEL: FileEntry = { name: 'model.yaml', kind: 'file' };

/** `n` model folders side by side, each with a hidden and a skipped folder. */
function sideBySide(n: number): FileSystemAdapter {
  const folders = new Map<string, FileEntry[]>();
  const root: FileEntry[] = [];
  for (let i = 0; i < n; i += 1) {
    root.push({ name: `m${i}`, kind: 'directory' });
    folders.set(`m${i}`, [
      MODEL,
      { name: 'entities', kind: 'directory' },
      { name: '.git', kind: 'directory' },
    ]);
    folders.set(`m${i}/entities`, [{ name: 'a.yaml', kind: 'file' }]);
  }
  folders.set('', root);
  return treeFileSystem(folders);
}

/** One model folder with `n` models inside it (`P02` each), two levels down. */
function nested(n: number): FileSystemAdapter {
  const folders = new Map<string, FileEntry[]>();
  const inside: FileEntry[] = [];
  for (let i = 0; i < n; i += 1) {
    inside.push({ name: `x${i}`, kind: 'directory' });
    folders.set(`m/x${i}`, [MODEL]);
  }
  folders.set('', [{ name: 'm', kind: 'directory' }]);
  folders.set('m', [MODEL, ...inside]);
  return treeFileSystem(folders);
}

describe('모델 찾기: time', () => {
  test.each([
    ['side by side', sideBySide, (n: number) => n, () => 0],
    ['inside one model', nested, () => 1, (n: number) => n],
  ])(
    'models %s: four times the folders takes about four times as long',
    { timeout: 120_000 },
    async (_name, make, models, p02s) => {
      await expectLinearTime({
        sizes: [5_000, 20_000],
        input: make,
        run: (fs) => findModels(fs, ''),
        check: (found, n) => {
          expect(found.models).toHaveLength(models(n));
          expect(found.issues).toHaveLength(p02s(n));
        },
        maxRatio: 8,
        backstop: 10_000,
      });
    },
  );

  test.each([
    ['all alike', () => 'shop'],
    ['all different', (i: number) => `m${i}`],
  ])(
    'model ids %s: four times the models takes about four times as long',
    { timeout: 120_000 },
    async (name, id) => {
      const measure = (sizes: readonly [number, number]) =>
        expectLinearTime({
          sizes,
          input: (n): ModelId[] =>
            Array.from({ length: n }, (_, i) => ({
              file: `m${i}/model.yaml`,
              id: id(i),
            })),
          run: modelIdIssues,
          check: (issues, n) =>
            expect(issues).toHaveLength(name === 'all alike' ? n : 0),
          maxRatio: 8,
          backstop: 10_000,
        });
      // Quadratic code would not end at 200k (sync code, no timeout stops it); fail it here in about a second.
      await measure([2_000, 8_000]);
      await measure([50_000, 200_000]);
    },
  );
});
