import * as fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { createNodeFileSystem } from './fs.js';

// On a filesystem that gives `readdir` no entry types, Node's typed listing
// looks at each entry itself and rejects with ENOENT as a whole when one of
// them is gone by then. This file stands in for that: the typed listing of
// the folder `racing` rejects so, and the listing by name still holds the
// entry `vanished`, which is not there.
const ENOENT = () =>
  Object.assign(new Error('ENOENT: no such file or directory, lstat'), {
    code: 'ENOENT',
  });

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const readdir = async (path: string, options?: { withFileTypes?: true }) => {
    if (!path.endsWith('racing')) return actual.readdir(path, options as never);
    if (options?.withFileTypes) throw ENOENT();
    return [...(await actual.readdir(path)), 'vanished'];
  };
  return { ...actual, readdir };
});

let root = '';

beforeAll(async () => {
  root = await fsp.mkdtemp(join(tmpdir(), 'erdmaker-node-fs-vanishing-'));
  const racing = join(root, 'racing');
  await fsp.mkdir(join(racing, 'folder'), { recursive: true });
  await fsp.writeFile(join(racing, 'a.yaml'), 'x', 'utf8');
  await fsp.writeFile(join(racing, 'b.yaml'), 'y', 'utf8');
  await fsp.symlink('a.yaml', join(racing, 'link.yaml'));
});

afterAll(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

test('an entry gone during a typed listing leaves out only itself, not its folder', async () => {
  const entries = await createNodeFileSystem(root).list('racing');
  expect([...entries].sort((a, b) => (a.name < b.name ? -1 : 1))).toEqual([
    { name: 'a.yaml', kind: 'file' },
    { name: 'b.yaml', kind: 'file' },
    { name: 'folder', kind: 'directory' },
  ]);
});

test('a folder gone before its listing by name is still an empty list', async () => {
  expect(await createNodeFileSystem(root).list('gone/racing')).toEqual([]);
});
