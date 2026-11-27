import { Document } from 'yaml';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { serializeModel } from './serialize.js';
import type { Model } from './types.js';

// A file whose text is longer than the longest JavaScript string (about
// 2 ** 29 characters) makes building it throw `RangeError: Invalid string
// length`. Building one takes gigabytes, so these tests make the builders
// throw that error instead.
vi.mock('./layout-json.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./layout-json.js')>();
  return {
    layoutJson: (...args: Parameters<typeof actual.layoutJson>) => {
      if (huge.layout) throw new RangeError('Invalid string length');
      return actual.layoutJson(...args);
    },
  };
});

const huge = { layout: false };

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

afterEach(() => {
  huge.layout = false;
  vi.restoreAllMocks();
});

describe('serializeModel: a file too large for a string', () => {
  test('a YAML file: a TypeError naming the file', () => {
    vi.spyOn(Document.prototype, 'toString').mockImplementation(() => {
      throw new RangeError('Invalid string length');
    });
    const of = model({
      entities: [
        {
          file: 'entities/e.yaml',
          data: { id: 'e', name: 'E', attributes: [] },
        },
      ],
    });
    expect(() => serializeModel(of)).toThrow(
      new TypeError('Cannot write entities/e.yaml: it is too large'),
    );
  });

  test('a layout file: a TypeError naming the file', () => {
    huge.layout = true;
    const of = model({
      layouts: [
        {
          file: 'layouts/main.json',
          data: { formatVersion: '0.1', nodes: {}, edges: {} },
        },
      ],
    });
    expect(() => serializeModel(of)).toThrow(
      new TypeError('Cannot write layouts/main.json: it is too large'),
    );
  });

  test('another error from building the text passes through unchanged', () => {
    const other = new Error('something else');
    vi.spyOn(Document.prototype, 'toString').mockImplementation(() => {
      throw other;
    });
    const of = model({
      entities: [
        {
          file: 'entities/e.yaml',
          data: { id: 'e', name: 'E', attributes: [] },
        },
      ],
    });
    expect(() => serializeModel(of)).toThrow(other);
  });
});
