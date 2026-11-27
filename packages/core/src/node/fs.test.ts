import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { FileSystemAdapter } from '../fs/adapter.js';
import { loadModel } from '../model/load.js';
import { exampleFiles, type Files, replaceOnce } from '../testing/example.js';
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

/** The adapter over `root`, and every path it was asked to list or read. */
function recorded(root: string): { fs: FileSystemAdapter; paths: string[] } {
  const inner = createNodeFileSystem(root);
  const paths: string[] = [];
  return {
    paths,
    fs: {
      ...inner,
      list: (dir) => {
        paths.push(dir);
        return inner.list(dir);
      },
      readText: (path) => {
        paths.push(path);
        return inner.readText(path);
      },
    },
  };
}

const names = async (root: string, dir: string) =>
  (await createNodeFileSystem(root).list(dir))
    .map((entry) => entry.name)
    .sort();

/** Real folders `entities/a` and `entities/b`, so the links between them have targets. */
const PAIR: Files = {
  'entities/a/.keep': '',
  'entities/b/.keep': '',
};

/** Each case: the links, and the names they take in `entities` (or in `a`/`b`). */
const LINKS: [string, Record<string, string>][] = [
  ['a link to a file', { 'entities/same.yaml': 'customer.yaml' }],
  ['a link to a folder', { 'entities/alias': '../elsewhere' }],
  ['a link to .', { 'entities/self': '.' }],
  ['a link to ..', { 'entities/up': '..' }],
  ['a link to /', { 'entities/top': '/' }],
  [
    'a dangling link',
    { 'entities/gone': 'missing', 'entities/gone.yaml': 'missing.yaml' },
  ],
  [
    'a link to itself',
    { 'entities/loop': 'loop', 'entities/loop.yaml': 'loop.yaml' },
  ],
  [
    'two folders linking to each other',
    { 'entities/a/to-b': '../b', 'entities/b/to-a': '../a' },
  ],
  [
    'a link to a sibling folder',
    { 'entities/to-a': 'a', 'entities/b.yaml': 'b' },
  ],
];

describe(
  'node adapter: symbolic links are not listed',
  { timeout: 5_000 },
  () => {
    test.each(LINKS)(
      '%s is absent from the listing and never entered',
      async (_name, links) => {
        const extra: Files = {
          ...PAIR,
          'elsewhere/extra.yaml': ENTITY('extra'),
        };
        const plain = await folder(extra);
        const root = await folder(extra, links);
        for (const dir of ['entities', 'entities/a', 'entities/b']) {
          expect(await names(root, dir)).toEqual(await names(plain, dir));
        }
        const { fs, paths } = recorded(root);
        const { model, issues } = await loadModel(fs, '');
        expect(issues).toEqual([]);
        expect(model.entities.map((item) => item.file)).toEqual(
          EXAMPLE_ENTITIES,
        );
        for (const link of Object.keys(links)) {
          expect(
            paths.filter(
              (path) => path === link || path.startsWith(`${link}/`),
            ),
          ).toEqual([]);
        }
      },
    );

    test('all of them in one folder: the model has exactly the example entities', async () => {
      const root = await folder(
        { ...PAIR, 'elsewhere/extra.yaml': ENTITY('extra') },
        Object.assign({}, ...LINKS.map(([, links]) => links)),
      );
      const { model, issues } = await loadModel(createNodeFileSystem(root), '');
      expect(issues).toEqual([]);
      expect(model.entities.map((item) => item.file)).toEqual(EXAMPLE_ENTITIES);
      expect(await createNodeFileSystem(root).list('entities/a')).toEqual([
        { name: '.keep', kind: 'file' },
      ]);
    });

    test('an adapter opened on a path through a linked folder reads the model', async () => {
      const real = await folder();
      const via = `${real}-via`;
      await symlink(dirname(real), via);
      const opened = join(via, String(cases));
      const { model, issues } = await loadModel(
        createNodeFileSystem(opened),
        '',
      );
      expect(issues).toEqual([]);
      expect(model.manifest).toBeDefined();
      expect(model.entities.map((item) => item.file)).toEqual(EXAMPLE_ENTITIES);
      // The opened folder itself may be a link too.
      await symlink(real, `${real}-alias`);
      expect(await names(`${real}-alias`, 'entities')).toEqual(
        await names(real, 'entities'),
      );
    });

    test('a file read by a path that is a link is read through the link', async () => {
      const store = await folder();
      const root = await folder(
        {},
        {
          'entities/same.yaml': 'customer.yaml',
          'linked.yaml': join(store, 'model.yaml'),
        },
      );
      const fs = createNodeFileSystem(root);
      expect(await fs.readText('entities/same.yaml')).toBe(
        exampleFiles()['entities/customer.yaml'],
      );
      expect(await fs.readText('linked.yaml')).toBe(
        exampleFiles()['model.yaml'],
      );
    });

    test('a model.yaml that is a link is read by name', async () => {
      const store = await folder();
      const root = await folder(
        {},
        { 'model.yaml.real': join(store, 'model.yaml') },
      );
      await rm(join(root, 'model.yaml'));
      await symlink('model.yaml.real', join(root, 'model.yaml'));
      const { model, issues } = await loadModel(createNodeFileSystem(root), '');
      expect(issues).toEqual([]);
      expect(model.manifest?.file).toBe('model.yaml');
      expect(model.entities.map((item) => item.file)).toEqual(EXAMPLE_ENTITIES);
    });
  },
);

describe('node adapter: dictionary folders that cannot exist', () => {
  test.each([
    ['a NUL character', '"dict\\0x"'],
    ['a name of 300 characters', 'n'.repeat(300)],
    ['a path of 6000 characters', 'a/'.repeat(3000)],
  ])(
    'a folder with %s is an empty dictionary and the rest is read',
    async (_name, entry) => {
      const root = await folder(
        replaceOnce(
          exampleFiles(),
          'model.yaml',
          'targets:\n',
          `dictionaries:\n  - ${entry}\ntargets:\n`,
        ),
      );
      const { model, issues } = await loadModel(createNodeFileSystem(root), '');
      expect(issues).toEqual([]);
      expect(model.manifest?.data.dictionaries).toEqual([
        entry === '"dict\\0x"' ? 'dict\0x' : entry,
      ]);
      expect(model.dictionaries).toEqual([]);
      expect(model.entities.map((item) => item.file)).toEqual(EXAMPLE_ENTITIES);
      expect(model.layouts).toHaveLength(2);
    },
  );
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

  /** Lists every folder below `root` as a walk does; the best time of three and the entries seen. */
  async function walk(root: string) {
    let best = Infinity;
    let entries = 0;
    for (let run = 0; run < 3; run += 1) {
      const fs = createNodeFileSystem(root);
      const start = performance.now();
      entries = 0;
      const pending = [''];
      for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
        for (const entry of await fs.list(dir)) {
          entries += 1;
          if (entry.kind === 'directory') {
            pending.push(dir === '' ? entry.name : `${dir}/${entry.name}`);
          }
        }
      }
      best = Math.min(best, performance.now() - start);
    }
    return { time: best, entries };
  }

  test.each([
    ['deep', deep, 200],
    ['wide', wide, 500],
  ])(
    'a %s tree: four times the folders takes about four times as long',
    { timeout: 60_000 },
    async (_name, make, size) => {
      const small = await walk(await make(size));
      const large = await walk(await make(size * 4));
      expect(small.entries).toBe(size * 2);
      expect(large.entries).toBe(size * 8);
      expect(large.time / small.time).toBeLessThan(12);
      expect(large.time).toBeLessThan(5_000);
    },
  );
});
