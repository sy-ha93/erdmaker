import { execFileSync } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { FileNotFoundError, type FileSystemAdapter } from '../fs/adapter.js';
import { loadModel } from '../model/load.js';
import { findModels } from '../project/find.js';
import { writeModel } from '../model/write.js';
import { exampleFiles, type Files, replaceOnce } from '../testing/example.js';
import { MAX_PATH_DEPTH, createNodeFileSystem } from './fs.js';

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

    test('a file read by a path that is a link is missing', async () => {
      const store = await folder();
      const root = await folder(
        {},
        {
          'entities/same.yaml': 'customer.yaml',
          'linked.yaml': join(store, 'model.yaml'),
        },
      );
      const fs = createNodeFileSystem(root);
      expect(await rejection(fs.readText('entities/same.yaml'))).toEqual(
        new FileNotFoundError('entities/same.yaml'),
      );
      expect(await rejection(fs.readText('linked.yaml'))).toEqual(
        new FileNotFoundError('linked.yaml'),
      );
    });

    test('a model.yaml that is a link is missing: loadModel rejects', async () => {
      const store = await folder();
      const root = await folder(
        {},
        { 'model.yaml.real': join(store, 'model.yaml') },
      );
      await rm(join(root, 'model.yaml'));
      await symlink('model.yaml.real', join(root, 'model.yaml'));
      expect(
        await rejection(loadModel(createNodeFileSystem(root), '')),
      ).toBeInstanceOf(FileNotFoundError);
    });
  },
);

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected the promise to reject');
    },
    (error: unknown) => error,
  );
}

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  );

/** A case folder holding the opened folder `root` and, beside it, `outside` with one file. */
async function besideOutside(): Promise<{ root: string; outside: string }> {
  cases += 1;
  const top = join(base, String(cases));
  const root = join(top, 'root');
  const outside = join(top, 'outside');
  await mkdir(join(root, 'real'), { recursive: true });
  await writeFile(join(root, 'real', 'in.yaml'), 'inside\n', 'utf8');
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, 'customer.yaml'), 'keep\n', 'utf8');
  return { root, outside };
}

const onTheWay = (path: string) =>
  new Error(`Cannot write ${path}: a folder on its way is a symbolic link`);

describe.skipIf(process.platform === 'win32')(
  'node adapter: no symbolic link below the opened folder',
  { timeout: 5_000 },
  () => {
    test('a linked folder on the way: read missing, list empty, remove and write change nothing outside', async () => {
      const { root, outside } = await besideOutside();
      await symlink('../outside', join(root, 'entities'));
      const fs = createNodeFileSystem(root);
      expect(await rejection(fs.readText('entities/customer.yaml'))).toEqual(
        new FileNotFoundError('entities/customer.yaml'),
      );
      expect(await fs.list('entities')).toEqual([]);
      await fs.remove('entities/customer.yaml');
      expect(
        await rejection(fs.writeText('entities/customer.yaml', 'x')),
      ).toEqual(onTheWay('entities/customer.yaml'));
      expect(
        await rejection(fs.writeText('entities/new/deep/a.yaml', 'x')),
      ).toEqual(onTheWay('entities/new/deep/a.yaml'));
      expect(await readFile(join(outside, 'customer.yaml'), 'utf8')).toBe(
        'keep\n',
      );
      expect(await readdir(outside)).toEqual(['customer.yaml']);
    });

    test('a link deeper on the way, to a folder inside the opened one, is refused too', async () => {
      const { root } = await besideOutside();
      await mkdir(join(root, 'a'));
      await symlink('../real', join(root, 'a', 'b'));
      const fs = createNodeFileSystem(root);
      expect(await rejection(fs.readText('a/b/in.yaml'))).toEqual(
        new FileNotFoundError('a/b/in.yaml'),
      );
      expect(await fs.list('a/b')).toEqual([]);
      expect(await rejection(fs.writeText('a/b/c/x.yaml', 'x'))).toEqual(
        onTheWay('a/b/c/x.yaml'),
      );
      await fs.remove('a/b/in.yaml');
      expect(await readdir(join(root, 'real'))).toEqual(['in.yaml']);
      // The real folder is read as usual, and the link is not listed.
      expect(await fs.readText('real/in.yaml')).toBe('inside\n');
      expect(await fs.list('a')).toEqual([]);
    });

    test('a link as the last entry: read missing, list empty, remove leaves it, write refused', async () => {
      const { root } = await besideOutside();
      await symlink('real/in.yaml', join(root, 'same.yaml'));
      await symlink('real', join(root, 'same'));
      const fs = createNodeFileSystem(root);
      expect(await rejection(fs.readText('same.yaml'))).toEqual(
        new FileNotFoundError('same.yaml'),
      );
      expect(await fs.list('same')).toEqual([]);
      await fs.remove('same.yaml');
      expect(await exists(join(root, 'same.yaml'))).toBe(true);
      expect(await rejection(fs.writeText('same.yaml', 'x'))).toEqual(
        new Error('Cannot write same.yaml: it is a symbolic link'),
      );
      expect(await readFile(join(root, 'real', 'in.yaml'), 'utf8')).toBe(
        'inside\n',
      );
    });

    test('writeModel through a linked entities folder writes nothing outside', async () => {
      const { root, outside } = await besideOutside();
      const { model } = await loadModel(
        createNodeFileSystem(await folder()),
        '',
      );
      for (const [path, text] of Object.entries(exampleFiles())) {
        if (path.startsWith('entities/')) continue;
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), text, 'utf8');
      }
      await writeFile(join(outside, 'address.yaml'), 'keep\n', 'utf8');
      await symlink('../outside', join(root, 'entities'));
      const fs = createNodeFileSystem(root);
      expect((await loadModel(fs, '')).model.entities).toEqual([]);
      expect(await rejection(writeModel(fs, model))).toEqual(
        onTheWay('entities/address.yaml'),
      );
      expect(await readFile(join(outside, 'customer.yaml'), 'utf8')).toBe(
        'keep\n',
      );
      expect(await readFile(join(outside, 'address.yaml'), 'utf8')).toBe(
        'keep\n',
      );
      expect(await readdir(outside)).toEqual(['address.yaml', 'customer.yaml']);
    });

    test('paths above the opened folder: real folders are used, linked ones are not', async () => {
      const { root, outside } = await besideOutside();
      await symlink('outside', join(dirname(root), 'alias'));
      const fs = createNodeFileSystem(root);
      expect(await fs.list('../outside')).toEqual([
        { name: 'customer.yaml', kind: 'file' },
      ]);
      expect(await fs.readText('../outside/customer.yaml')).toBe('keep\n');
      await fs.writeText('../outside/new/a.yaml', 'a\n');
      expect(await readFile(join(outside, 'new', 'a.yaml'), 'utf8')).toBe(
        'a\n',
      );
      expect(await fs.list('../alias')).toEqual([]);
      expect(await rejection(fs.readText('../alias/customer.yaml'))).toEqual(
        new FileNotFoundError('../alias/customer.yaml'),
      );
      expect(await rejection(fs.writeText('../alias/b.yaml', 'b'))).toEqual(
        onTheWay('../alias/b.yaml'),
      );
      await fs.remove('../alias/customer.yaml');
      expect((await readdir(outside)).sort()).toEqual(['customer.yaml', 'new']);
    });

    test('an opened folder that is a link, or reached through one, is read and written', async () => {
      const { root } = await besideOutside();
      await symlink(root, `${root}-alias`);
      await symlink(dirname(root), `${dirname(root)}-via`);
      for (const opened of [
        `${root}-alias`,
        join(`${dirname(root)}-via`, 'root'),
      ]) {
        const fs = createNodeFileSystem(opened);
        expect(await fs.readText('real/in.yaml')).toBe('inside\n');
        await fs.writeText('real/new/x.yaml', 'x\n');
        expect(await fs.list('real/new')).toEqual([
          { name: 'x.yaml', kind: 'file' },
        ]);
        await fs.remove('real/new/x.yaml');
        expect(await fs.list('real/new')).toEqual([]);
      }
    });

    test('a FIFO, a socket or a folder is missing, and a FIFO is not opened', async () => {
      const { root } = await besideOutside();
      execFileSync('mkfifo', [join(root, 'pipe.yaml')]);
      const server = createServer();
      await new Promise<void>((done) =>
        server.listen(join(root, 'socket.yaml'), done),
      );
      try {
        const fs = createNodeFileSystem(root);
        expect(await rejection(fs.readText('pipe.yaml'))).toEqual(
          new FileNotFoundError('pipe.yaml'),
        );
        expect(await rejection(fs.readText('socket.yaml'))).toEqual(
          new FileNotFoundError('socket.yaml'),
        );
        expect(await rejection(fs.readText('real'))).toEqual(
          new FileNotFoundError('real'),
        );
      } finally {
        await new Promise((done) => server.close(done));
      }
    });
  },
);

describe('node adapter: a bad name is refused before any folder is made', () => {
  test.each([
    ['a NUL character', 'created/a\0.yaml'],
    ['a name longer than 255 characters', `created/${'n'.repeat(256)}/a.yaml`],
    // Windows counts UTF-16 units, so 86 of these are a short name there.
    ...(process.platform === 'win32'
      ? []
      : [
          [
            'a name longer than 255 bytes in UTF-8',
            `created/${'한'.repeat(86)}`,
          ],
        ]),
  ])('%s: rejected, nothing created', async (_name, path) => {
    const { root } = await besideOutside();
    const fs = createNodeFileSystem(root);
    expect(await rejection(fs.writeText(path, 'x'))).toBeInstanceOf(Error);
    expect(await exists(join(root, 'created'))).toBe(false);
  });
});

describe('node adapter on win32: a backslash is not part of a name', () => {
  const platform = process.platform;
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform });
  });

  // Elsewhere a backslash is an ordinary name character, so the files can be made.
  test.skipIf(platform === 'win32')(
    'read missing, list empty, remove no-op, write refused before any folder is made',
    async () => {
      const { root } = await besideOutside();
      await writeFile(join(root, 'a\\b.yaml'), 'x', 'utf8');
      await mkdir(join(root, 'd\\e'));
      await writeFile(join(root, 'd\\e', 'f.yaml'), 'y', 'utf8');
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const fs = createNodeFileSystem(root);
      expect(await rejection(fs.readText('a\\b.yaml'))).toEqual(
        new FileNotFoundError('a\\b.yaml'),
      );
      expect(await fs.list('d\\e')).toEqual([]);
      await fs.remove('a\\b.yaml');
      expect(await rejection(fs.writeText('new\\x/a.yaml', 'x'))).toEqual(
        new TypeError(
          'A path cannot hold a backslash on Windows: new\\x/a.yaml',
        ),
      );
      Object.defineProperty(process, 'platform', { value: platform });
      expect(await exists(join(root, 'new\\x'))).toBe(false);
      expect(await exists(join(root, 'a\\b.yaml'))).toBe(true);
    },
  );
});

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

const tooDeep = (path: string) =>
  new TypeError(`Cannot write ${path}: its path has more than 32 folders`);

describe('node adapter: at most 32 folders below the opened folder', () => {
  const folders = (count: number) => Array(count).fill('d').join('/');

  test('32 folders: read, list, write and remove work', async () => {
    const { root } = await besideOutside();
    const fs = createNodeFileSystem(root);
    const path = `${folders(MAX_PATH_DEPTH)}/f.yaml`;
    await fs.writeText(path, 'x\n');
    expect(await fs.readText(path)).toBe('x\n');
    expect(await fs.list(folders(MAX_PATH_DEPTH))).toEqual([
      { name: 'f.yaml', kind: 'file' },
    ]);
    await fs.remove(path);
    expect(await fs.list(folders(MAX_PATH_DEPTH))).toEqual([]);
  });

  test('33 folders: read missing, list empty, remove no-op, write refused before any folder is made', async () => {
    const { root } = await besideOutside();
    // Made by hand: the adapter does not go this deep.
    const deep = join(root, ...Array(33).fill('d'));
    await mkdir(deep, { recursive: true });
    await writeFile(join(deep, 'f.yaml'), 'x\n', 'utf8');
    const fs = createNodeFileSystem(root);
    const path = `${folders(33)}/f.yaml`;
    expect(await rejection(fs.readText(path))).toEqual(
      new FileNotFoundError(path),
    );
    expect(await fs.list(folders(33))).toEqual([]);
    await fs.remove(path);
    expect(await readdir(deep)).toEqual(['f.yaml']);
    expect(await rejection(fs.writeText(`new/${path}`, 'x'))).toEqual(
      tooDeep(`new/${path}`),
    );
    expect(await exists(join(root, 'new'))).toBe(false);
    // Leading `..` and parts normalized away do not count; names after `..` do.
    const listed = [{ name: 'd', kind: 'directory' }];
    expect(await fs.list(`../root/${folders(31)}`)).toEqual(listed);
    expect(await fs.list(`../root/${folders(32)}`)).toEqual([]);
    expect(await fs.list(`${'x/../'.repeat(40)}${folders(32)}`)).toEqual(
      listed,
    );
  });

  test('a path string of 1 MB or of more than 4096 characters is impossible, without a stack error', async () => {
    const { root } = await besideOutside();
    const fs = createNodeFileSystem(root);
    for (const path of ['a/'.repeat(500_000) + 'f', `${'n'.repeat(4097)}`]) {
      expect(await rejection(fs.readText(path))).toEqual(
        new FileNotFoundError(path),
      );
      expect(await fs.list(path)).toEqual([]);
      await fs.remove(path);
      const error = await rejection(fs.writeText(path, 'x'));
      expect(error).toBeInstanceOf(TypeError);
      expect((error as Error).message).toBe(
        `Cannot write ${path.slice(0, 200)}…: its path is longer than 4096 characters`,
      );
    }
    expect(await readdir(root)).toEqual(['real']);
  });

  test('a missing opened folder is made for a write', async () => {
    const { root } = await besideOutside();
    const missing = join(root, 'not', 'yet');
    const fs = createNodeFileSystem(missing);
    await fs.writeText('model.yaml', 'x\n');
    expect(await readFile(join(missing, 'model.yaml'), 'utf8')).toBe('x\n');
    const other = createNodeFileSystem(join(root, 'other'));
    await other.writeText('a/b/c.yaml', 'y\n');
    expect(
      await readFile(join(root, 'other', 'a', 'b', 'c.yaml'), 'utf8'),
    ).toBe('y\n');
  });
});

describe.skipIf(process.platform === 'win32')(
  'node adapter: links that cannot be followed are never entered',
  () => {
    test('a linked folder at depth 5: read missing, list empty, remove and write change nothing', async () => {
      const { root, outside } = await besideOutside();
      await mkdir(join(root, 'a', 'b', 'c', 'd'), { recursive: true });
      await symlink(outside, join(root, 'a', 'b', 'c', 'd', 'e'));
      const fs = createNodeFileSystem(root);
      expect(await rejection(fs.readText('a/b/c/d/e/customer.yaml'))).toEqual(
        new FileNotFoundError('a/b/c/d/e/customer.yaml'),
      );
      expect(await fs.list('a/b/c/d/e')).toEqual([]);
      await fs.remove('a/b/c/d/e/customer.yaml');
      expect(
        await rejection(fs.writeText('a/b/c/d/e/customer.yaml', 'x')),
      ).toEqual(onTheWay('a/b/c/d/e/customer.yaml'));
      expect(await readdir(outside)).toEqual(['customer.yaml']);
      expect(await readFile(join(outside, 'customer.yaml'), 'utf8')).toBe(
        'keep\n',
      );
    });

    test('a linked folder whose target cannot be entered: missing, not EACCES', async () => {
      const { root, outside } = await besideOutside();
      await symlink(outside, join(root, 'locked'));
      await chmod(outside, 0o000);
      try {
        const fs = createNodeFileSystem(root);
        expect(await rejection(fs.readText('locked/customer.yaml'))).toEqual(
          new FileNotFoundError('locked/customer.yaml'),
        );
        expect(await fs.list('locked')).toEqual([]);
        await fs.remove('locked/customer.yaml');
        expect(await rejection(fs.writeText('locked/x/y.yaml', 'x'))).toEqual(
          onTheWay('locked/x/y.yaml'),
        );
      } finally {
        await chmod(outside, 0o755);
      }
    });

    test('a looping link on the way: write refused as a link, not ELOOP', async () => {
      const { root } = await besideOutside();
      await symlink('loop', join(root, 'loop'));
      const fs = createNodeFileSystem(root);
      expect(await rejection(fs.writeText('loop/a.yaml', 'x'))).toEqual(
        onTheWay('loop/a.yaml'),
      );
      expect(await rejection(fs.writeText('loop', 'x'))).toEqual(
        new Error('Cannot write loop: it is a symbolic link'),
      );
      expect(await rejection(fs.readText('loop/a.yaml'))).toEqual(
        new FileNotFoundError('loop/a.yaml'),
      );
      expect(await fs.list('loop')).toEqual([]);
    });

    test('a real folder that cannot be entered: the error surfaces', async () => {
      const { root } = await besideOutside();
      await chmod(join(root, 'real'), 0o000);
      try {
        const fs = createNodeFileSystem(root);
        expect(errorCode(await rejection(fs.readText('real/in.yaml')))).toBe(
          'EACCES',
        );
        expect(errorCode(await rejection(fs.list('real')))).toBe('EACCES');
      } finally {
        await chmod(join(root, 'real'), 0o755);
      }
    });
  },
);

const errorCode = (error: unknown) =>
  (error as { code?: unknown } | null)?.code;

describe('node adapter: walks through a tree deeper than the limit end quietly', () => {
  /** `entity-<k>.yaml` in the folder `k` levels below `top`, for k = 1 to 40. */
  const deepEntities = (top: string): Files =>
    Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [
        `${top}/${Array(i + 1)
          .fill('d')
          .join('/')}/entity-${i + 1}.yaml`,
        ENTITY(`deep${i + 1}`),
      ]),
    );
  /** The files of `deepEntities(top)` the adapter reaches: at most 32 folders, `top` included. */
  const reached = (top: string) =>
    Object.keys(deepEntities(top))
      .filter((path) => path.split('/').length - 1 <= MAX_PATH_DEPTH)
      .sort();

  test('entities: the files up to 32 folders deep are read, the rest is left out', async () => {
    const root = await folder(deepEntities('entities'));
    const { model, issues } = await loadModel(createNodeFileSystem(root), '');
    expect(issues).toEqual([]);
    expect(
      model.entities
        .map((item) => item.file)
        .filter((file) => file.startsWith('entities/d/')),
    ).toEqual(reached('entities'));
    expect(reached('entities')).toHaveLength(MAX_PATH_DEPTH - 1);
  });

  test('a dictionary folder above the model: the same limit below the folder `..` climbs to', async () => {
    cases += 1;
    const top = join(base, String(cases));
    const files: Files = {
      ...replaceOnce(
        exampleFiles(),
        'model.yaml',
        'targets:\n',
        'dictionaries:\n  - ../shared\ntargets:\n',
      ),
    };
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(top, 'model', path)), { recursive: true });
      await writeFile(join(top, 'model', path), text, 'utf8');
    }
    const words = (i: number) =>
      `words:\n  - id: w${i}\n    name: w${i}\n    englishName: w${i}\n    abbreviation: W${i}\n`;
    for (let i = 1; i <= 40; i += 1) {
      const dir = join(top, 'shared', ...Array(i).fill('d'));
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `dict-${i}.yaml`), words(i), 'utf8');
    }
    const { model, issues } = await loadModel(
      createNodeFileSystem(join(top, 'model')),
      '',
    );
    expect(issues).toEqual([]);
    // `shared` and 31 folders below it: 32 folders below the folder `..` climbs to.
    expect(model.dictionaries).toHaveLength(MAX_PATH_DEPTH - 1);
  });

  test('findModels below a deep folder: a model 32 folders deep is found, one deeper is not', async () => {
    const { root } = await besideOutside();
    const at = (depth: number) => Array(depth).fill('d').join('/');
    const fs = createNodeFileSystem(root);
    await fs.writeText(`${at(32)}/model.yaml`, 'x\n');
    const deeper = join(root, ...Array(33).fill('d'), 'e');
    await mkdir(deeper, { recursive: true });
    await writeFile(join(deeper, 'model.yaml'), 'x\n', 'utf8');
    expect(await findModels(fs, at(31))).toEqual({
      models: [at(32)],
      issues: [],
    });
    expect(await findModels(fs, at(33))).toEqual({ models: [], issues: [] });
  });
});
