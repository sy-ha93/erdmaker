import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createNodeFileSystem } from '../node/index.js';
import { FileNotFoundError, type FileSystemAdapter } from './adapter.js';
import { createMemoryFileSystem } from './memory.js';

/** Builds an adapter whose opened folder holds `files` (keys may start with `../`). */
type MakeAdapter = (
  files: Record<string, string>,
) => Promise<FileSystemAdapter>;

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected the promise to reject');
    },
    (error: unknown) => error,
  );
}

function sortedEntries(entries: { name: string; kind: string }[]) {
  return [...entries].sort((a, b) => (a.name < b.name ? -1 : 1));
}

function adapterContract(name: string, make: MakeAdapter) {
  describe(`어댑터 계약: ${name}`, () => {
    test('reads back what it wrote', async () => {
      const fs = await make({});
      await fs.writeText('a.txt', 'hello');
      expect(await fs.readText('a.txt')).toBe('hello');
    });

    test('writes the text unchanged (line endings, non-ASCII, no final newline)', async () => {
      const fs = await make({});
      const text = 'a\r\nb\n한글 ✓\r\nend';
      await fs.writeText('t.yaml', text);
      expect(await fs.readText('t.yaml')).toBe(text);
    });

    test('overwrites an existing file', async () => {
      const fs = await make({ 'a.txt': 'old' });
      await fs.writeText('a.txt', 'new');
      expect(await fs.readText('a.txt')).toBe('new');
    });

    test('reads a file it was given', async () => {
      const fs = await make({ 'm/entities/order.yaml': 'id: order\n' });
      expect(await fs.readText('m/entities/order.yaml')).toBe('id: order\n');
    });

    test('writes under parent folders that do not exist yet', async () => {
      const fs = await make({});
      await fs.writeText('x/y/z/deep.json', '{}\n');
      expect(await fs.readText('x/y/z/deep.json')).toBe('{}\n');
      expect(await fs.list('x/y')).toEqual([{ name: 'z', kind: 'directory' }]);
    });

    test('list tells files from folders', async () => {
      const fs = await make({
        'm/model.yaml': 'id: m\n',
        'm/entities/a.yaml': 'id: a\n',
        'm/entities/sub/b.yaml': 'id: b\n',
        'm/layouts/main.json': '{}\n',
      });
      expect(sortedEntries(await fs.list('m'))).toEqual([
        { name: 'entities', kind: 'directory' },
        { name: 'layouts', kind: 'directory' },
        { name: 'model.yaml', kind: 'file' },
      ]);
      expect(sortedEntries(await fs.list('m/entities'))).toEqual([
        { name: 'a.yaml', kind: 'file' },
        { name: 'sub', kind: 'directory' },
      ]);
    });

    test('list of the opened folder is ""', async () => {
      const fs = await make({ 'a.txt': '1', 'd/b.txt': '2' });
      expect(sortedEntries(await fs.list(''))).toEqual([
        { name: 'a.txt', kind: 'file' },
        { name: 'd', kind: 'directory' },
      ]);
    });

    test('list of a folder that does not exist is an empty list', async () => {
      const fs = await make({ 'a.txt': '1' });
      expect(await fs.list('nope')).toEqual([]);
      expect(await fs.list('nope/deeper')).toEqual([]);
    });

    test('list of a path that is a file is an empty list', async () => {
      const fs = await make({ 'a.txt': '1' });
      expect(await fs.list('a.txt')).toEqual([]);
    });

    test('reading a missing file rejects with FileNotFoundError', async () => {
      const fs = await make({ 'a.txt': '1' });
      const error = await rejection(fs.readText('missing.txt'));
      expect(error).toBeInstanceOf(FileNotFoundError);
      expect((error as FileNotFoundError).path).toBe('missing.txt');
      expect(await rejection(fs.readText('no/such/dir/x.txt'))).toBeInstanceOf(
        FileNotFoundError,
      );
    });

    test('reading through a file in the middle of the path rejects with FileNotFoundError', async () => {
      const fs = await make({ 'a.txt': '1' });
      expect(await rejection(fs.readText('a.txt/b.txt'))).toBeInstanceOf(
        FileNotFoundError,
      );
    });

    test('reading a folder rejects with FileNotFoundError: it is no file', async () => {
      const fs = await make({ 'd/b.txt': '1' });
      const error = await rejection(fs.readText('d'));
      expect(error).toEqual(new FileNotFoundError('d'));
      expect((error as FileNotFoundError).path).toBe('d');
    });

    test('remove deletes the file', async () => {
      const fs = await make({ 'd/a.txt': '1', 'd/b.txt': '2' });
      await fs.remove('d/a.txt');
      expect(await rejection(fs.readText('d/a.txt'))).toBeInstanceOf(
        FileNotFoundError,
      );
      expect(await fs.list('d')).toEqual([{ name: 'b.txt', kind: 'file' }]);
      expect(await fs.readText('d/b.txt')).toBe('2');
    });

    test('remove of a missing file does nothing', async () => {
      const fs = await make({ 'a.txt': '1' });
      await expect(fs.remove('missing.txt')).resolves.toBeUndefined();
      await expect(fs.remove('no/such/dir/x.txt')).resolves.toBeUndefined();
      expect(sortedEntries(await fs.list(''))).toEqual([
        { name: 'a.txt', kind: 'file' },
      ]);
    });

    test('writing onto a folder or through a file rejects and changes nothing', async () => {
      const fs = await make({ 'd/a.txt': '1', 'f.txt': '2' });
      expect(await rejection(fs.writeText('d', 'x'))).toBeInstanceOf(Error);
      expect(await rejection(fs.writeText('f.txt/b.txt', 'x'))).toBeInstanceOf(
        Error,
      );
      expect(await fs.readText('d/a.txt')).toBe('1');
      expect(await fs.readText('f.txt')).toBe('2');
    });

    test('remove of a folder rejects and keeps its files', async () => {
      const fs = await make({ 'd/a.txt': '1' });
      expect(await rejection(fs.remove('d'))).toBeInstanceOf(Error);
      expect(await fs.readText('d/a.txt')).toBe('1');
    });

    test('reads a path that starts with ..', async () => {
      const fs = await make({
        'model.yaml': 'id: m\n',
        '../dictionary/standard.yaml': 'words: []\n',
      });
      expect(await fs.readText('../dictionary/standard.yaml')).toBe(
        'words: []\n',
      );
      expect(await fs.list('../dictionary')).toEqual([
        { name: 'standard.yaml', kind: 'file' },
      ]);
      expect(await fs.list('')).toEqual([{ name: 'model.yaml', kind: 'file' }]);
    });

    // A NUL character, a name of 300 characters, a path of 6000 characters.
    test.each([
      ['with a NUL character', 'dict\0x'],
      ['with a name too long for any system', 'n'.repeat(300)],
      ['too long for any system', 'a/'.repeat(3000)],
    ])(
      'a path that cannot exist (%s) is missing: empty list, FileNotFoundError, nothing removed',
      async (_name, path) => {
        const fs = await make({ 'a.txt': '1' });
        expect(await fs.list(path)).toEqual([]);
        const error = await rejection(fs.readText(path));
        expect(error).toBeInstanceOf(FileNotFoundError);
        expect((error as FileNotFoundError).path).toBe(path);
        expect(await rejection(fs.readText(`${path}/b.txt`))).toBeInstanceOf(
          FileNotFoundError,
        );
        await expect(fs.remove(path)).resolves.toBeUndefined();
        expect(await fs.list('')).toEqual([{ name: 'a.txt', kind: 'file' }]);
      },
    );

    test('writing a path with a NUL character rejects and creates nothing', async () => {
      const fs = await make({ 'a.txt': '1' });
      expect(await rejection(fs.writeText('d\0/x.txt', 'x'))).toBeInstanceOf(
        Error,
      );
      expect(await fs.list('')).toEqual([{ name: 'a.txt', kind: 'file' }]);
    });

    test('paths are normalized (a/../b, ./, doubled slashes)', async () => {
      const fs = await make({ 'b/c.txt': '1' });
      expect(await fs.readText('a/../b/c.txt')).toBe('1');
      expect(await fs.readText('./b//c.txt')).toBe('1');
    });
  });
}

adapterContract('memory', async (files) => createMemoryFileSystem(files));

test('the memory adapter is not given a file whose path has a NUL character', () => {
  expect(() => createMemoryFileSystem({ 'a\0b.txt': '1' })).toThrow(TypeError);
});

let nodeTemp = '';
let nodeCases = 0;

beforeAll(async () => {
  nodeTemp = await mkdtemp(join(tmpdir(), 'erdmaker-adapter-'));
});

afterAll(async () => {
  if (nodeTemp) await rm(nodeTemp, { recursive: true, force: true });
});

/** Each case gets `<temp>/<n>/root` as the opened folder, so `../x` lands in `<temp>/<n>/x`. */
async function makeNodeCase(files: Record<string, string>) {
  nodeCases += 1;
  const root = join(nodeTemp, String(nodeCases), 'root');
  await mkdir(root, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, text, 'utf8');
  }
  return { root, fs: createNodeFileSystem(root) };
}

adapterContract('node', async (files) => (await makeNodeCase(files)).fs);

describe('Node adapter on disk', () => {
  test('writes the exact bytes to the file under the root folder', async () => {
    const { root, fs } = await makeNodeCase({});
    await fs.writeText('m/a.yaml', 'x: 1\r\ny: 한\n');
    expect(await readFile(join(root, 'm', 'a.yaml'))).toEqual(
      Buffer.from('x: 1\r\ny: 한\n', 'utf8'),
    );
  });

  test('a relative root folder resolves against the current directory', async () => {
    const { root } = await makeNodeCase({ 'a.txt': '1' });
    const fs = createNodeFileSystem(relative(process.cwd(), root));
    expect(await fs.readText('a.txt')).toBe('1');
  });
});
