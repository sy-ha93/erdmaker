import { Document } from 'yaml';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { SchemaName } from '../schema/ajv.js';
import { exampleFileSystem } from '../testing/example.js';
import { loadModel } from './load.js';
import { serializeItem } from './serialize-item.js';
import { serializeModel } from './serialize.js';

vi.mock('./layout-json.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./layout-json.js')>();
  return {
    layoutJson: (...args: Parameters<typeof actual.layoutJson>) => {
      if (layoutError.value) throw layoutError.value;
      return actual.layoutJson(...args);
    },
  };
});

const layoutError: { value: unknown } = { value: undefined };

/** What `run` threw (fails when it returns). */
function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('nothing was thrown');
}

const ENTITY = { id: 'e', name: 'E', attributes: [] };

afterEach(() => {
  layoutError.value = undefined;
  vi.restoreAllMocks();
});

describe('항목 직렬화', () => {
  test('each item of the example has the text serializeModel writes for its file', async () => {
    const { model } = await loadModel(exampleFileSystem(), '');
    const expected = new Map(
      serializeModel(model).map(({ file, text }) => [file, text]),
    );
    const items: [string, unknown, SchemaName][] = [];
    if (model.manifest) {
      items.push([model.manifest.file, model.manifest.data, 'model']);
    }
    const lists = [
      [model.dictionaries, 'dictionary'],
      [model.entities, 'entity'],
      [model.relationships, 'relationship'],
      [model.subtypes, 'subtype'],
      [model.subjectAreas, 'subject-area'],
      [model.layouts, 'layout'],
    ] as const;
    for (const [list, schema] of lists) {
      for (const { file, data } of list) items.push([file, data, schema]);
    }
    expect(items).toHaveLength(29);
    expect(expected.size).toBe(29);
    for (const [file, data, schema] of items) {
      expect(serializeItem(file, data, schema)).toBe(expected.get(file));
    }
  });

  test('a RangeError from the YAML text becomes a TypeError with it as the cause', () => {
    const original = new RangeError('Invalid string length');
    vi.spyOn(Document.prototype, 'toString').mockImplementation(() => {
      throw original;
    });
    const error = thrown(() =>
      serializeItem('entities/e.yaml', ENTITY, 'entity'),
    );
    expect(error).toBeInstanceOf(TypeError);
    expect((error as TypeError).message).toBe(
      'Cannot write entities/e.yaml: it is too large or too deeply nested to write',
    );
    expect((error as TypeError).cause).toBe(original);
  });

  test('a RangeError from the layout text becomes a TypeError with it as the cause', () => {
    const original = new RangeError('Invalid string length');
    layoutError.value = original;
    const error = thrown(() =>
      serializeItem(
        'layouts/main.json',
        { formatVersion: '0.1', nodes: {} },
        'layout',
      ),
    );
    expect(error).toBeInstanceOf(TypeError);
    expect((error as TypeError).message).toBe(
      'Cannot write layouts/main.json: it is too large or too deeply nested to write',
    );
    expect((error as TypeError).cause).toBe(original);
  });

  test('another error from the layout text passes through unchanged', () => {
    const original = new Error('something else');
    layoutError.value = original;
    expect(
      thrown(() =>
        serializeItem(
          'layouts/main.json',
          { formatVersion: '0.1', nodes: {} },
          'layout',
        ),
      ),
    ).toBe(original);
  });

  test('an accessor that throws a RangeError is not called: the data is not a JSON value', () => {
    const getter = vi.fn(() => {
      throw new RangeError('from the getter');
    });
    const data = { ...ENTITY };
    Object.defineProperty(data, 'definition', {
      get: getter,
      enumerable: true,
    });
    const error = thrown(() =>
      serializeItem('entities/e.yaml', data, 'entity'),
    );
    expect(error).toEqual(
      new TypeError(
        'Cannot write entities/e.yaml: /definition must be a JSON value',
      ),
    );
    expect(error).toBeInstanceOf(TypeError);
    expect(getter).not.toHaveBeenCalled();
  });

  test('a Proxy whose first ownKeys throws a RangeError: the data is not a JSON value', () => {
    const ext = new Proxy(
      {},
      {
        ownKeys() {
          throw new RangeError('from ownKeys');
        },
      },
    );
    const error = thrown(() =>
      serializeItem('entities/e.yaml', { ...ENTITY, ext }, 'entity'),
    );
    expect(error).toEqual(
      new TypeError('Cannot write entities/e.yaml: /ext must be a JSON value'),
    );
    expect(error).toBeInstanceOf(TypeError);
  });

  describe('which error wins inside one item', () => {
    const deepArray = (levels: number): unknown => {
      let list: unknown = [];
      for (let level = 2; level <= levels; level += 1) list = [list];
      return list;
    };
    const doubling = (levels: number): unknown => {
      let value: unknown = { x: 1 };
      for (let level = 0; level < levels; level += 1) {
        value = { a: value, b: value };
      }
      return value;
    };
    const both = (data: Record<string, unknown>) => [
      () => serializeItem('entities/e.yaml', data, 'entity'),
      () =>
        serializeModel({
          dir: '',
          entities: [{ file: 'entities/e.yaml', data: data as never }],
          relationships: [],
          subtypes: [],
          subjectAreas: [],
          layouts: [],
          dictionaries: [],
        }),
    ];

    test('a value that is not JSON wins over nesting too deep', () => {
      const data = { ...ENTITY, ext: { deep: deepArray(300), f: () => 1 } };
      for (const run of both(data)) {
        const error = thrown(run);
        expect(error).toEqual(
          new TypeError(
            'Cannot write entities/e.yaml: /ext/f must be a JSON value',
          ),
        );
        expect(error).toBeInstanceOf(TypeError);
      }
    });

    test('nesting too deep wins over shared objects copied too often', () => {
      const data = {
        ...ENTITY,
        ext: { shared: doubling(40), deep: deepArray(300) },
      };
      const path = `/ext/deep${'/0'.repeat(254)}`;
      for (const run of both(data)) {
        const error = thrown(run);
        expect(error).toEqual(
          new TypeError(
            `Cannot write entities/e.yaml: ${path} is nested more than 256 levels deep`,
          ),
        );
        expect(error).toBeInstanceOf(TypeError);
      }
    });
  });

  test('a RangeError from writing the data in order passes through unchanged', () => {
    const original = new RangeError('from the second ownKeys');
    let calls = 0;
    const ext = new Proxy(
      { a: 1 },
      {
        ownKeys(target) {
          calls += 1;
          if (calls === 2) throw original;
          return Reflect.ownKeys(target);
        },
      },
    );
    expect(
      thrown(() =>
        serializeItem('entities/e.yaml', { ...ENTITY, ext }, 'entity'),
      ),
    ).toBe(original);
    expect(calls).toBe(2);
  });
});
