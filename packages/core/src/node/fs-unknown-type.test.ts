import type { Dirent } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { createNodeFileSystem } from './fs.js';

// Some filesystems give `readdir` no entry types. This file stands in for one:
// `readdir` returns entries whose type methods all say no.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const untyped = (dirent: Dirent): Dirent =>
    Object.assign(Object.create(dirent) as Dirent, {
      isFile: () => false,
      isDirectory: () => false,
      isSymbolicLink: () => false,
      isFIFO: () => false,
      isSocket: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
    });
  return {
    ...actual,
    readdir: async (path: string, options: { withFileTypes: true }) => {
      const dirents = await actual.readdir(path, options);
      const named = Object.assign(untyped(dirents[0] ?? ({} as Dirent)), {
        name: 'vanished',
      });
      return [...dirents.map(untyped), named];
    },
  };
});

let root = '';

beforeAll(async () => {
  root = await fsp.mkdtemp(join(tmpdir(), 'erdmaker-node-fs-untyped-'));
  await fsp.mkdir(join(root, 'folder'));
  await fsp.writeFile(join(root, 'file.yaml'), 'x', 'utf8');
  await fsp.symlink('folder', join(root, 'to-folder'));
  await fsp.symlink('file.yaml', join(root, 'to-file.yaml'));
  await fsp.symlink('missing', join(root, 'dangling'));
  await fsp.symlink('loop', join(root, 'loop'));
});

afterAll(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

test('entries without a type are looked at with lstat: links and vanished entries are left out', async () => {
  const entries = await createNodeFileSystem(root).list('');
  expect([...entries].sort((a, b) => (a.name < b.name ? -1 : 1))).toEqual([
    { name: 'file.yaml', kind: 'file' },
    { name: 'folder', kind: 'directory' },
  ]);
});
