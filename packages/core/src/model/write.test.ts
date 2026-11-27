import { describe, expect, test } from 'vitest';
import { FileNotFoundError, type FileSystemAdapter } from '../fs/adapter.js';
import { createMemoryFileSystem } from '../fs/memory.js';
import { exampleFiles, type Files, replaceOnce } from '../testing/example.js';
import { validateModel } from '../validate/index.js';
import { loadModel } from './load.js';
import { serializeModel } from './serialize.js';
import type { Model } from './types.js';
import { writeModel } from './write.js';

/** A memory adapter that also counts the writes and removals made through it. */
function recording(files: Files) {
  const inner = createMemoryFileSystem(files);
  const calls = { writes: [] as string[], removes: 0 };
  const fs: FileSystemAdapter = {
    readText: (path) => inner.readText(path),
    list: (dir) => inner.list(dir),
    async writeText(path, text) {
      calls.writes.push(path);
      await inner.writeText(path, text);
    },
    async remove(path) {
      calls.removes += 1;
      await inner.remove(path);
    },
  };
  return { fs, calls };
}

/** Every file the adapter holds under its opened folder, as `path → text`. */
async function contents(fs: FileSystemAdapter): Promise<Files> {
  const out: Files = {};
  const pending = [''];
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    for (const { name, kind } of await fs.list(dir)) {
      const path = dir === '' ? name : `${dir}/${name}`;
      if (kind === 'directory') pending.push(path);
      else out[path] = await fs.readText(path);
    }
  }
  return Object.fromEntries(
    Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

async function example(files: Files = exampleFiles()) {
  const { fs, calls } = recording(files);
  const { model } = await loadModel(fs, '');
  return { fs, calls, model };
}

const withEntity = (model: Model, index: number, data: unknown): Model => ({
  ...model,
  entities: model.entities.map((item, i) =>
    i === index ? { ...item, data: data as never } : item,
  ),
});

describe('바뀐 파일만 쓰기', () => {
  test('the example as it is: nothing is written', async () => {
    const { fs, calls, model } = await example();
    expect(await writeModel(fs, model)).toEqual([]);
    expect(calls.writes).toEqual([]);
    expect(await contents(fs)).toEqual(exampleFiles());
  });

  test("one entity's name changed: only that file is written, as serializeModel gives it", async () => {
    const { fs, calls, model } = await example();
    const index = model.entities.findIndex(
      (item) => item.file === 'entities/tag.yaml',
    );
    const changed = withEntity(model, index, {
      ...model.entities[index]!.data,
      name: '꼬리표',
    });
    expect(await writeModel(fs, changed)).toEqual(['entities/tag.yaml']);
    expect(calls.writes).toEqual(['entities/tag.yaml']);
    const expected = replaceOnce(
      exampleFiles(),
      'entities/tag.yaml',
      'name: 태그\n',
      'name: 꼬리표\n',
    );
    const text = serializeModel(changed).find(
      (file) => file.file === 'entities/tag.yaml',
    )!.text;
    expect(text).toBe(expected['entities/tag.yaml']);
    const after = await contents(fs);
    expect(after).toEqual(expected);
    expect(Object.keys(after)).toHaveLength(29);
  });

  test('a new entity item: its file is made, folders included', async () => {
    const { fs, calls, model } = await example();
    const data = { id: 'coupon', name: '쿠폰', attributes: [] };
    const added: Model = {
      ...model,
      entities: [...model.entities, { file: 'entities/new/coupon.yaml', data }],
    };
    expect(await writeModel(fs, added)).toEqual(['entities/new/coupon.yaml']);
    expect(calls.writes).toEqual(['entities/new/coupon.yaml']);
    expect(await contents(fs)).toEqual({
      ...exampleFiles(),
      'entities/new/coupon.yaml': 'id: coupon\nname: 쿠폰\nattributes: []\n',
    });
  });

  test('a file left out on reading (schema error) keeps its bytes', async () => {
    const files = replaceOnce(
      exampleFiles(),
      'entities/tag.yaml',
      'name: 태그\n',
      'name: 태그\nbogus: 1\n',
    );
    const { fs, calls, model } = await example(files);
    expect(model.entities.map((item) => item.file)).not.toContain(
      'entities/tag.yaml',
    );
    expect(await writeModel(fs, model)).toEqual([]);
    expect(calls.writes).toEqual([]);
    expect(await contents(fs)).toEqual(files);
  });

  test('a value that is not JSON data: reported, not serialized, and nothing is written', async () => {
    for (const value of [Infinity, 2 ** 53]) {
      const { fs, calls, model } = await example();
      const index = model.entities.findIndex(
        (item) => item.file === 'entities/order.yaml',
      );
      const order = model.entities[index]!.data;
      // Another file changes too, so a partial write would show.
      const changed = withEntity(
        withEntity(model, 0, { ...model.entities[0]!.data, name: 'x' }),
        index,
        {
          ...order,
          attributes: order.attributes.map((attribute, i) =>
            i === 0 ? { ...attribute, default: value } : attribute,
          ),
        },
      );
      expect(validateModel(changed)).toContainEqual({
        rule: 'schema',
        severity: 'error',
        file: 'entities/order.yaml',
        path: '/attributes/0/default',
        message: '/attributes/0/default must be a JSON value',
      });
      expect(() => serializeModel(changed)).toThrow(
        'Cannot write entities/order.yaml: /attributes/0/default must be a JSON value',
      );
      await expect(writeModel(fs, changed)).rejects.toThrow(TypeError);
      expect(calls).toEqual({ writes: [], removes: 0 });
      expect(await contents(fs)).toEqual(exampleFiles());
    }
  });
});

describe('바뀐 파일만 쓰기: the files there', () => {
  test('a file that differs only in form is written back in form; files not in the model stay', async () => {
    const files = {
      ...replaceOnce(
        exampleFiles(),
        'entities/tag.yaml',
        'name: 태그\n',
        'name: 태그\r\n',
      ),
      'notes.txt': 'not a model file\n',
      'entities/extra.yml': 'id: x\n',
    };
    const { fs, calls, model } = await example(files);
    expect(await writeModel(fs, model)).toEqual(['entities/tag.yaml']);
    expect(calls).toEqual({ writes: ['entities/tag.yaml'], removes: 0 });
    expect(await contents(fs)).toEqual({
      ...files,
      'entities/tag.yaml': exampleFiles()['entities/tag.yaml'],
    });
  });

  test('a dictionary outside the opened folder is written at its path', async () => {
    const files: Files = {};
    for (const [path, text] of Object.entries(exampleFiles())) {
      files[path.startsWith('dictionary/') ? `../${path}` : path] = text;
    }
    files['model.yaml'] = files['model.yaml']!.replace(
      'areaGroups:',
      'dictionaries:\n  - ../dictionary\nareaGroups:',
    );
    const { fs, model } = await example(files);
    expect(model.dictionaries.map((item) => item.file)).toEqual([
      '../dictionary/standard.yaml',
    ]);
    const words = model.dictionaries[0]!.data.words!;
    const changed: Model = {
      ...model,
      dictionaries: [
        {
          ...model.dictionaries[0]!,
          data: { ...model.dictionaries[0]!.data, words: words.slice(1) },
        },
      ],
    };
    expect(await writeModel(fs, changed)).toEqual([
      '../dictionary/standard.yaml',
    ]);
    expect(await fs.readText('../dictionary/standard.yaml')).toBe(
      serializeModel(changed).find(
        (file) => file.file === '../dictionary/standard.yaml',
      )!.text,
    );
  });

  test('a read that fails other than as missing rejects before anything is written', async () => {
    const { fs, calls, model } = await example();
    const failing: FileSystemAdapter = {
      ...fs,
      async readText(path) {
        if (path === 'subtypes/customer_type.yaml') throw new Error('EACCES');
        return fs.readText(path);
      },
    };
    const changed = withEntity(model, 0, {
      ...model.entities[0]!.data,
      name: 'x',
    });
    await expect(writeModel(failing, changed)).rejects.toThrow('EACCES');
    expect(calls.writes).toEqual([]);
    // A missing file is not a failure: it is written.
    const missing: FileSystemAdapter = {
      ...fs,
      async readText(path) {
        if (path === 'subtypes/customer_type.yaml')
          throw new FileNotFoundError(path);
        return fs.readText(path);
      },
    };
    expect(await writeModel(missing, changed)).toEqual([
      model.entities[0]!.file,
      'subtypes/customer_type.yaml',
    ]);
  });

  test('the model is not changed', async () => {
    const { fs, model } = await example();
    const changed = withEntity(model, 0, {
      ...model.entities[0]!.data,
      name: 'x',
    });
    const before = JSON.stringify(changed);
    await writeModel(fs, changed);
    expect(JSON.stringify(changed)).toBe(before);
  });
});
