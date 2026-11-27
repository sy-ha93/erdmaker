import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadModel } from '../model/load.js';
import { exampleFiles, type Files } from '../testing/example.js';
import { createNodeFileSystem } from './fs.js';

const ENTITY = (id: string) => `id: ${id}\nname: ${id}\nattributes: []\n`;

/** The example's ten entity files. */
const EXAMPLE_ENTITIES = Object.keys(exampleFiles())
  .filter((path) => path.startsWith('entities/'))
  .sort();

let base = '';
let cases = 0;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'erdmaker-node-fs-'));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

/** A new folder holding the example plus `extra` files, with `links` as `path → target`. */
async function folder(
  extra: Files = {},
  links: Record<string, string> = {},
): Promise<string> {
  cases += 1;
  const root = join(base, String(cases));
  for (const [path, text] of Object.entries({ ...exampleFiles(), ...extra })) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text, 'utf8');
  }
  for (const [path, target] of Object.entries(links)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await symlink(target, join(root, path));
  }
  return root;
}

async function entityFiles(root: string): Promise<string[]> {
  const { model, issues } = await loadModel(createNodeFileSystem(root), '');
  expect(issues).toEqual([]);
  return model.entities.map((item) => item.file);
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected the promise to reject');
    },
    (error: unknown) => error,
  );
}

// Each case would walk forever, or read hundreds of copies, if a loop were followed.
describe('node adapter: symbolic links', { timeout: 5_000 }, () => {
  test('a link to the listed folder, or to a folder above it, is not followed', async () => {
    const root = await folder(
      {},
      { 'entities/self': '.', 'entities/up': '..', 'entities/top': '/' },
    );
    expect(await entityFiles(root)).toEqual(EXAMPLE_ENTITIES);
    const names = (await createNodeFileSystem(root).list('entities')).map(
      (entry) => entry.name,
    );
    expect(names).not.toContain('self');
    expect(names).not.toContain('up');
    expect(names).not.toContain('top');
    expect(names).toContain('customer.yaml');
  });

  test('two links to the listed folder: each file once', async () => {
    const root = await folder({}, { 'entities/a': '.', 'entities/b': '.' });
    expect(await entityFiles(root)).toEqual(EXAMPLE_ENTITIES);
  });

  test('a link to a sibling folder is followed, and so is a link to a file', async () => {
    const root = await folder(
      { 'entities/more/extra.yaml': ENTITY('extra') },
      { 'entities/alias': 'more', 'entities/same.yaml': 'tag.yaml' },
    );
    expect(await entityFiles(root)).toEqual(
      [
        ...EXAMPLE_ENTITIES,
        'entities/alias/extra.yaml',
        'entities/more/extra.yaml',
        'entities/same.yaml',
      ].sort(),
    );
    expect(await createNodeFileSystem(root).list('entities/alias')).toEqual([
      { name: 'extra.yaml', kind: 'file' },
    ]);
  });

  test('a dangling link is left out', async () => {
    const root = await folder(
      {},
      { 'entities/gone': 'missing', 'entities/gone.yaml': 'missing.yaml' },
    );
    expect(await entityFiles(root)).toEqual(EXAMPLE_ENTITIES);
  });

  test('a loop through two folders: each folder is entered once per path into it', async () => {
    const root = await folder(
      { 'entities/a/x.yaml': ENTITY('x'), 'entities/b/y.yaml': ENTITY('y') },
      { 'entities/a/to-b': '../b', 'entities/b/to-a': '../a' },
    );
    expect(await entityFiles(root)).toEqual(
      [
        ...EXAMPLE_ENTITIES,
        'entities/a/to-b/y.yaml',
        'entities/a/x.yaml',
        'entities/b/to-a/x.yaml',
        'entities/b/y.yaml',
      ].sort(),
    );
  });

  test('a loop in a folder outside the opened folder is not followed either', async () => {
    const root = await folder(
      {},
      { '../shared-1/self': '.', '../shared-1/up': '..' },
    );
    expect(await createNodeFileSystem(root).list('../shared-1')).toEqual([]);
  });

  test('a link that loops on itself rejects with ELOOP', async () => {
    const root = await folder({}, { 'entities/loop': 'loop' });
    const error = await rejection(loadModel(createNodeFileSystem(root), ''));
    expect(error).toMatchObject({ code: 'ELOOP' });
  });

  test.skipIf(process.getuid?.() === 0)(
    'a link into a folder that cannot be searched rejects with EACCES',
    async () => {
      const root = await folder(
        { 'locked/inner/z.yaml': ENTITY('z') },
        { 'entities/in': '../locked/inner' },
      );
      await chmod(join(root, 'locked'), 0o000);
      try {
        const error = await rejection(
          loadModel(createNodeFileSystem(root), ''),
        );
        expect(error).toMatchObject({ code: 'EACCES' });
      } finally {
        await chmod(join(root, 'locked'), 0o755);
      }
    },
  );
});
