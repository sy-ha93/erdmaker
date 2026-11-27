import * as fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { MAX_PATH_DEPTH, createNodeFileSystem } from './fs.js';

// Counts the calls that look at or make one path each, to show that the
// work per adapter call grows with the path's depth only, by one each.
const calls = { lstat: 0, mkdir: 0 };

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    lstat: (...args: Parameters<typeof actual.lstat>) => {
      calls.lstat += 1;
      return actual.lstat(...args);
    },
    mkdir: (...args: Parameters<typeof actual.mkdir>) => {
      calls.mkdir += 1;
      return actual.mkdir(...args);
    },
  };
});

let root = '';
const folders = (count: number) => Array(count).fill('d').join('/');

beforeAll(async () => {
  root = await fsp.mkdtemp(join(tmpdir(), 'erdmaker-node-fs-work-'));
  const deepest = join(root, 'tree', ...Array(MAX_PATH_DEPTH - 1).fill('d'));
  await fsp.mkdir(deepest, { recursive: true });
  for (let depth = 0; depth < MAX_PATH_DEPTH; depth += 1) {
    const dir = join(root, 'tree', ...Array(depth).fill('d'));
    await fsp.writeFile(join(dir, 'f.yaml'), 'x', 'utf8');
  }
});

afterAll(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  calls.lstat = 0;
  calls.mkdir = 0;
});

test.each([1, 2, 8, MAX_PATH_DEPTH])(
  'readText of a file %i names deep looks at each name once',
  async (depth) => {
    const fs = createNodeFileSystem(root);
    const path = ['tree', ...Array(depth - 1).fill('d')].join('/');
    expect(await fs.readText(`${path}/f.yaml`)).toBe('x');
    expect(calls.lstat).toBe(depth + 1);
  },
);

test.each([1, 2, 8, MAX_PATH_DEPTH])(
  'list of a folder %i names deep looks at each name once',
  async (depth) => {
    const fs = createNodeFileSystem(root);
    const path = ['tree', ...Array(depth - 1).fill('d')].join('/');
    await fs.list(path);
    expect(calls.lstat).toBe(depth);
  },
);

test.each([1, 2, 8, MAX_PATH_DEPTH])(
  'writeText below %i missing folders makes each one once',
  async (depth) => {
    const fs = createNodeFileSystem(join(root, `new-${depth}`));
    const path = `${folders(depth)}/f.yaml`;
    await fs.writeText(path, 'y');
    expect(await fs.readText(path)).toBe('y');
    calls.lstat = 0;
    calls.mkdir = 0;
    await fs.writeText(`${folders(depth)}x/f.yaml`, 'z');
    // The first folders are there; the last one is made.
    expect(calls.lstat).toBeLessThanOrEqual(depth + 2);
    expect(calls.mkdir).toBeLessThanOrEqual(2);
  },
);

test('writeText makes no folder when the opened folder, or the one `..` climbs to, is there', async () => {
  const fs = createNodeFileSystem(join(root, 'tree'));
  await fs.writeText('g.yaml', 'y');
  expect(calls.mkdir).toBe(0);
  await fs.writeText('../tree/d/g.yaml', 'y');
  expect(calls.mkdir).toBe(0);
  expect(await fs.readText('d/g.yaml')).toBe('y');
});

test.each([1, 2, 8, MAX_PATH_DEPTH])(
  'writeText into a fully missing chain of %i folders: work linear in the depth',
  async (depth) => {
    const fs = createNodeFileSystem(join(root, `chain-${depth}`));
    await fs.writeText(`${folders(depth)}/f.yaml`, 'y');
    // One look and one make per folder, plus the opened folder and the file.
    expect(calls.lstat).toBeLessThanOrEqual(depth + 2);
    expect(calls.mkdir).toBeLessThanOrEqual(depth + 1);
  },
);
