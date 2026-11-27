import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { expectLinearTime } from '../testing/timing.js';
import { MAX_PATH_DEPTH, createNodeFileSystem } from './fs.js';

let base = '';
let cases = 0;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'erdmaker-node-fs-perf-'));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('node adapter: walk time', () => {
  /**
   * `chains` folders side by side, each the top of `MAX_PATH_DEPTH` nested
   * folders with a file in each: the deepest tree the adapter walks.
   */
  async function deep(chains: number): Promise<string> {
    cases += 1;
    const root = join(base, String(cases));
    for (let chain = 0; chain < chains; chain += 1) {
      let dir = join(root, `c${chain}`);
      for (let level = 0; level < MAX_PATH_DEPTH; level += 1) {
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'f.yaml'), 'x', 'utf8');
        dir = join(dir, 'd');
      }
    }
    return root;
  }

  /** `width` folders side by side, each with a file. */
  async function wide(width: number): Promise<string> {
    cases += 1;
    const root = join(base, String(cases));
    for (let i = 0; i < width; i += 1) {
      await mkdir(join(root, `d${i}`), { recursive: true });
      await writeFile(join(root, `d${i}`, 'f.yaml'), 'x', 'utf8');
    }
    return root;
  }

  /** Lists every folder below `root` as a walk does, with a new adapter; the entries seen. */
  async function walk(root: string): Promise<number> {
    const fs = createNodeFileSystem(root);
    let entries = 0;
    const pending = [''];
    for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
      for (const entry of await fs.list(dir)) {
        entries += 1;
        if (entry.kind === 'directory') {
          pending.push(dir === '' ? entry.name : `${dir}/${entry.name}`);
        }
      }
    }
    return entries;
  }

  // Linear: about 4 for both. A call looks at each folder of its path once
  // and a path has at most `MAX_PATH_DEPTH` folders, so each folder costs
  // the same however many there are. Listing the parent folder again for
  // every folder makes the wide ratio about 11.
  test.each([
    ['deep', deep, 8, MAX_PATH_DEPTH],
    ['wide', wide, 500, 1],
  ])(
    'a %s tree: four times the folders takes about four times as long',
    { timeout: 120_000 },
    async (_name, make, size, folders) => {
      await expectLinearTime({
        sizes: [size, size * 4],
        input: make,
        run: walk,
        // A folder and its file per level of each chain, or per folder.
        check: (entries, count) => expect(entries).toBe(count * folders * 2),
        maxRatio: 8,
        backstop: 5_000,
      });
    },
  );
});
