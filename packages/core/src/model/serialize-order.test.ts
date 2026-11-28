import { Document } from 'yaml';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { serializeModel } from './serialize.js';
import type { Model } from './types.js';

// Pins which errors `serializeModel` turns into its own `TypeError` and in
// what order it looks at the items, so splitting out the per-item writer
// cannot move the boundary.
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

const model = (partial: Partial<Model>): Model => ({
  dir: '',
  entities: [],
  relationships: [],
  subtypes: [],
  subjectAreas: [],
  layouts: [],
  dictionaries: [],
  ...partial,
});

const entity = (file: string, data: Record<string, unknown>) => ({
  file,
  data: data as never,
});

/** What `run` threw (fails when it returns). */
function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('nothing was thrown');
}

afterEach(() => {
  layoutError.value = undefined;
  vi.restoreAllMocks();
});

describe('serializeModel: 예외의 경계', () => {
  test('every item is checked before any text is built', () => {
    const toString = vi
      .spyOn(Document.prototype, 'toString')
      .mockImplementation(() => {
        throw new RangeError('Invalid string length');
      });
    const of = model({
      entities: [
        entity('entities/a.yaml', { id: 'a', name: 'A', attributes: [] }),
        entity('entities/b.yaml', {
          id: 'b',
          name: 'B',
          attributes: [],
          x: () => 1,
        }),
      ],
    });
    expect(() => serializeModel(of)).toThrow(
      new TypeError('Cannot write entities/b.yaml: /x must be a JSON value'),
    );
    expect(toString).not.toHaveBeenCalled();
  });

  test('a RangeError from the YAML text becomes a TypeError with it as the cause', () => {
    const original = new RangeError('Invalid string length');
    vi.spyOn(Document.prototype, 'toString').mockImplementation(() => {
      throw original;
    });
    const of = model({
      entities: [
        entity('entities/e.yaml', { id: 'e', name: 'E', attributes: [] }),
      ],
    });
    const error = thrown(() => serializeModel(of));
    expect(error).toBeInstanceOf(TypeError);
    expect((error as TypeError).message).toBe(
      'Cannot write entities/e.yaml: it is too large or too deeply nested to write',
    );
    expect((error as TypeError).cause).toBe(original);
  });

  test('a RangeError from the layout text becomes a TypeError with it as the cause', () => {
    const original = new RangeError('Invalid string length');
    layoutError.value = original;
    const of = model({
      layouts: [
        {
          file: 'layouts/main.json',
          data: { formatVersion: '0.1', nodes: {} },
        },
      ],
    });
    const error = thrown(() => serializeModel(of));
    expect(error).toBeInstanceOf(TypeError);
    expect((error as TypeError).message).toBe(
      'Cannot write layouts/main.json: it is too large or too deeply nested to write',
    );
    expect((error as TypeError).cause).toBe(original);
  });

  test('another error from the layout text passes through unchanged', () => {
    const original = new Error('something else');
    layoutError.value = original;
    const of = model({
      layouts: [
        {
          file: 'layouts/main.json',
          data: { formatVersion: '0.1', nodes: {} },
        },
      ],
    });
    expect(thrown(() => serializeModel(of))).toBe(original);
  });

  test('an accessor that throws a RangeError is not called: the data is not a JSON value', () => {
    const getter = vi.fn(() => {
      throw new RangeError('from the getter');
    });
    const data = { id: 'e', name: 'E', attributes: [] };
    Object.defineProperty(data, 'definition', {
      get: getter,
      enumerable: true,
    });
    const of = model({ entities: [entity('entities/e.yaml', data)] });
    const error = thrown(() => serializeModel(of));
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
    const of = model({
      entities: [
        entity('entities/e.yaml', { id: 'e', name: 'E', attributes: [], ext }),
      ],
    });
    const error = thrown(() => serializeModel(of));
    expect(error).toEqual(
      new TypeError('Cannot write entities/e.yaml: /ext must be a JSON value'),
    );
    expect(error).toBeInstanceOf(TypeError);
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
    const of = model({
      entities: [
        entity('entities/e.yaml', { id: 'e', name: 'E', attributes: [], ext }),
      ],
    });
    expect(thrown(() => serializeModel(of))).toBe(original);
    expect(calls).toBe(2);
  });
});
