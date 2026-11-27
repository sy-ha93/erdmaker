import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { expectLinearTime } from '../testing/timing.js';
import { createNodeFileSystem } from './fs.js';

let base = '';
let cases = 0;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'erdmaker-node-fs-perf-'));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('node adapter: walk time', () => {
  /** `depth` nested folders `d`, each with a file. */
  async function deep(depth: number): Promise<string> {
    cases += 1;
    const root = join(base, String(cases));
    let dir = root;
    for (let level = 0; level < depth; level += 1) {
      dir = join(dir, 'd');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'f.yaml'), 'x', 'utf8');
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

  // Linear: about 4 for the wide tree, about 6 for the deep one, whose paths
  // grow with the depth (the system resolves each). Listing the parent folder
  // again for every folder makes the wide ratio about 11.
  test.each([
    ['deep', deep, 200, 12],
    ['wide', wide, 500, 8],
  ])(
    'a %s tree: four times the folders takes about four times as long',
    { timeout: 120_000 },
    async (_name, make, size, maxRatio) => {
      await expectLinearTime({
        sizes: [size, size * 4],
        input: make,
        run: walk,
        // A folder and its file per level or per folder.
        check: (entries, folders) => expect(entries).toBe(folders * 2),
        maxRatio,
        backstop: 5_000,
      });
    },
  );
});
