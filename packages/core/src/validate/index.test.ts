import { describe, expect, test } from 'vitest';
import { loadModel } from '../model/load.js';
import { serializeModel } from '../model/serialize.js';
import type { EntityData, Issue, Model } from '../model/types.js';
import {
  exampleFileSystem,
  exampleFiles,
  replaceOnce,
} from '../testing/example.js';
import { MAX_NESTING } from '../parse/yaml.js';
import { validateModel } from './index.js';
import { ABSOLUTE_MESSAGE } from './manifest.js';

const emptyModel = (): Model => ({
  dir: '',
  entities: [],
  relationships: [],
  subtypes: [],
  subjectAreas: [],
  layouts: [],
  dictionaries: [],
});

const entity = (file: string, data: unknown) => ({
  file,
  data: data as EntityData,
});

const schemaIssue = (
  file: string,
  path: string,
  message: string,
  position?: { line: number; column: number },
): Issue => ({
  rule: 'schema',
  severity: 'error',
  file,
  path,
  ...position,
  message,
});

/** Nested `depth` levels below `leaf`. */
function deep(depth: number, leaf: unknown = 'x'): unknown {
  let value = leaf;
  for (let i = 0; i < depth; i += 1) value = { a: [value] };
  return value;
}

describe('validateModel: schema and JSON values', () => {
  test('the example model read from the example has no issues', async () => {
    const { model, positions } = await loadModel(exampleFileSystem(), '');
    expect(validateModel(model, positions)).toEqual([]);
    expect(validateModel(model)).toEqual([]);
  });

  test('a model changed in memory: paths without positions, sorted by file, every list checked', async () => {
    const { model } = await loadModel(exampleFileSystem(), '');
    const changed: Model = {
      ...model,
      manifest: model.manifest && {
        ...model.manifest,
        data: { ...model.manifest.data, notation: 'x' as 'ie' },
      },
      entities: [
        entity('entities/z.yaml', { id: 'z', name: 'Z', attributes: null }),
        ...model.entities,
      ],
      layouts: [{ file: 'layouts/new.json', data: { nodes: {} } as never }],
      dictionaries: [
        { file: 'd/a.yaml', data: { words: 1 } as never },
        ...model.dictionaries,
      ],
    };
    // Without the manifest no area group is known: the rule issues have no position either.
    const unknownGroup = (area: string, group: string): Issue => ({
      rule: 'R12',
      severity: 'error',
      file: `subject-areas/${area}.yaml`,
      path: '/group',
      message: `unknown area group "${group}"`,
    });
    expect(validateModel(changed)).toEqual([
      schemaIssue('d/a.yaml', '/words', '/words must be array'),
      schemaIssue(
        'entities/z.yaml',
        '/attributes',
        '/attributes must be array',
      ),
      schemaIssue(
        'layouts/new.json',
        '',
        "/ must have required property 'formatVersion'",
      ),
      schemaIssue(
        'model.yaml',
        '/notation',
        '/notation must be equal to one of the allowed values',
      ),
      unknownGroup('catalog', 'master'),
      unknownGroup('party', 'master'),
      unknownGroup('sales', 'trade'),
    ]);
    expect(model.entities).toHaveLength(10);
  });

  test('with positions, an item from disk gets the position of its path', async () => {
    const { model, positions } = await loadModel(exampleFileSystem(), '');
    // No file refers to subject area party, so leaving it out takes no rule issue with it.
    const first = model.subjectAreas.find(
      (item) => item.file === 'subject-areas/party.yaml',
    );
    if (!first) throw new Error('no subject area party');
    const changed: Model = {
      ...model,
      subjectAreas: model.subjectAreas.map((item) =>
        item === first
          ? { ...first, data: { ...first.data, name: 7 as unknown as string } }
          : item,
      ),
    };
    expect(validateModel(changed, positions)).toEqual([
      schemaIssue(first.file, '/name', '/name must be string', {
        line: 2,
        column: 1,
      }),
    ]);
  });

  test('values that are not JSON data are reported without throwing', () => {
    const cyclic: Record<string, unknown> = {
      id: 'c',
      name: 'C',
      attributes: [],
    };
    cyclic.ext = { self: cyclic };
    const model: Model = {
      ...emptyModel(),
      entities: [
        entity('a.yaml', {
          id: 'a',
          name: 'A',
          attributes: [],
          ext: { d: new Date(0) },
        }),
        entity('b.yaml', cyclic),
        entity('c.yaml', undefined),
        entity('d.yaml', () => 1),
      ],
    };
    expect(validateModel(model)).toEqual([
      schemaIssue('a.yaml', '/ext/d', '/ext/d must be a JSON value'),
      schemaIssue('b.yaml', '/ext/self', '/ext/self must be a JSON value'),
      // `undefined` and a function are safe to read, so the schema is checked too.
      schemaIssue('c.yaml', '', '/ must be a JSON value'),
      schemaIssue('c.yaml', '', '/ must be object'),
      schemaIssue('d.yaml', '', '/ must be a JSON value'),
      schemaIssue('d.yaml', '', '/ must be object'),
    ]);
  });

  test('a malformed model is checked without throwing', () => {
    const getter = Object.defineProperty({ file: 'g.yaml' }, 'data', {
      enumerable: true,
      get() {
        throw new Error('called');
      },
    });
    const revoked = Proxy.revocable([], {});
    revoked.revoke();
    const huge: unknown[] = [];
    huge.length = 2 ** 32 - 1;
    const model = {
      dir: '',
      manifest: null,
      entities: [null, 7, 'x', { data: {} }, { file: 1 }, getter],
      relationships: { file: 'r.yaml', data: {} },
      subtypes: revoked.proxy,
      subjectAreas: huge,
      layouts: [{ file: 'l.json' }],
    } as unknown as Model;
    expect(validateModel(model)).toEqual([
      schemaIssue('g.yaml', '', '/ must be a JSON value'),
      schemaIssue('g.yaml', '', '/ must be object'),
      schemaIssue('l.json', '', '/ must be a JSON value'),
      schemaIssue('l.json', '', '/ must be object'),
    ]);
    expect(validateModel({} as Model)).toEqual([]);
    expect(validateModel(null as unknown as Model)).toEqual([]);
  });

  test('getters that would return items are not called: their lists and items count as missing', () => {
    let calls = 0;
    const getter = <T>(value: T) => ({
      enumerable: true,
      get() {
        calls += 1;
        return value;
      },
    });
    const bad = entity('bad.yaml', { id: 1 });
    const model = Object.defineProperties(
      {
        ...emptyModel(),
        entities: [
          Object.defineProperty({ file: 'a.yaml' }, 'data', getter(bad.data)),
          Object.defineProperty({ data: bad.data }, 'file', getter('b.yaml')),
        ],
        relationships: Object.defineProperty([], '0', getter(bad)),
      },
      { layouts: getter([bad]), dictionaries: getter([bad]) },
    ) as unknown as Model;
    expect(validateModel(model)).toEqual([
      // `data` behind a getter is `undefined`; an item whose `file` is behind one is skipped.
      schemaIssue('a.yaml', '', '/ must be a JSON value'),
      schemaIssue('a.yaml', '', '/ must be object'),
    ]);
    expect(calls).toBe(0);
  });

  test('data nested 100000 levels deep is checked without throwing', () => {
    const model: Model = {
      ...emptyModel(),
      entities: [
        entity('a.yaml', {
          id: 'a',
          name: 'A',
          attributes: [{ id: 'x', name: 'X', default: deep(100_000) }],
          ext: { d: deep(100_000) },
        }),
      ],
      subjectAreas: [
        {
          file: 'b.yaml',
          data: {
            id: 'b',
            name: 'B',
            entities: [deep(100_000), deep(100_000)],
          } as never,
        },
      ],
    };
    const messages = validateModel(model).map((found) => found.message);
    expect(messages).toContain(
      '/entities must NOT have duplicate items (items ## 0 and 1 are identical)',
    );
    expect(messages).toContain(
      '/attributes/0/default must match exactly one schema in oneOf',
    );
  });

  test('does not change the model', async () => {
    const { model } = await loadModel(exampleFileSystem(), '');
    const before = JSON.stringify(model);
    validateModel(model);
    expect(JSON.stringify(model)).toBe(before);
  });
});

describe('validateModel: absolute dictionaries entries', () => {
  const manifest = (dictionaries: unknown) => ({
    ...emptyModel(),
    manifest: {
      file: 'm/model.yaml',
      data: { formatVersion: '0.1', id: 'm', name: 'M', dictionaries } as never,
    },
  });

  test('a model made in memory: an error per absolute entry, without a position', () => {
    const entries: unknown[] = ['/abs', 'dictionary', 'C:\\dict', 'c:/d'];
    entries[5] = '\\share';
    expect(validateModel(manifest(entries))).toEqual([
      // The hole at 4 is not JSON data; the entries keep their own indexes.
      schemaIssue(
        'm/model.yaml',
        '/dictionaries/4',
        '/dictionaries/4 must be a JSON value',
      ),
      schemaIssue('m/model.yaml', '/dictionaries/0', ABSOLUTE_MESSAGE),
      schemaIssue('m/model.yaml', '/dictionaries/2', ABSOLUTE_MESSAGE),
      schemaIssue('m/model.yaml', '/dictionaries/3', ABSOLUTE_MESSAGE),
      schemaIssue('m/model.yaml', '/dictionaries/5', ABSOLUTE_MESSAGE),
    ]);
    expect(
      validateModel(manifest(['dictionary', '../shared', 'a:b', '.\\x'])),
    ).toEqual([]);
  });

  test('entries that are not strings or are behind a getter are not read as paths', () => {
    let calls = 0;
    const behind = Object.defineProperty(
      { formatVersion: '0.1' },
      'dictionaries',
      {
        enumerable: true,
        get() {
          calls += 1;
          return ['/abs'];
        },
      },
    );
    const messages = (model: Model) =>
      validateModel(model).map((issue) => issue.message);
    expect(messages(manifest([1, ['/abs']]))).not.toContain(ABSOLUTE_MESSAGE);
    expect(
      messages({
        ...emptyModel(),
        manifest: { file: 'model.yaml', data: behind as never },
      }),
    ).not.toContain(ABSOLUTE_MESSAGE);
    expect(calls).toBe(0);
  });

  test('with positions from loadModel, the error gets the position of the entry', async () => {
    const files = replaceOnce(
      exampleFiles(),
      'model.yaml',
      'targets:\n',
      'dictionaries:\n  - /abs/dict\n  - dictionary\ntargets:\n',
    );
    const { model, positions } = await loadModel(exampleFileSystem(files), '');
    expect(validateModel(model, positions)).toEqual([
      schemaIssue('model.yaml', '/dictionaries/0', ABSOLUTE_MESSAGE, {
        line: 6,
        column: 5,
      }),
    ]);
  });
});

describe('validateModel: data nested deeper than a file may hold', () => {
  const TOO_DEEP = `is nested more than ${MAX_NESTING} levels deep`;

  /** `arrays` arrays, each the only item of the one around it, around `leaf`. */
  function arrays(count: number, leaf: unknown[] = []): unknown[] {
    let value = leaf;
    for (let level = 1; level < count; level += 1) value = [value];
    return value;
  }

  /** The example's manifest with `ext: { k: value }`. */
  async function exampleWith(value: unknown): Promise<Model> {
    const { model } = await loadModel(exampleFileSystem(), '');
    return {
      ...model,
      manifest: model.manifest && {
        ...model.manifest,
        data: { ...model.manifest.data, ext: { k: value as never } },
      },
    };
  }

  // The manifest is level 1, `ext` level 2 and `k`'s array level 3.
  const pathAt257 = `/ext/k${'/0'.repeat(254)}`;

  test('a value 257 levels deep is one schema issue, and the item is left out of the rules', async () => {
    // Without the manifest no area group is known (as in the memory model test above).
    const unknownGroup = (area: string, group: string): Issue => ({
      rule: 'R12',
      severity: 'error',
      file: `subject-areas/${area}.yaml`,
      path: '/group',
      message: `unknown area group "${group}"`,
    });
    expect(validateModel(await exampleWith(arrays(255)))).toEqual([
      schemaIssue('model.yaml', pathAt257, `${pathAt257} ${TOO_DEEP}`),
      unknownGroup('catalog', 'master'),
      unknownGroup('party', 'master'),
      unknownGroup('sales', 'trade'),
    ]);
    // 256 levels is what a file may hold.
    expect(validateModel(await exampleWith(arrays(254)))).toEqual([]);
  });

  test('objects count as levels too, and keys are escaped in the path', async () => {
    let value: unknown = {};
    for (let level = 1; level < 255; level += 1) value = { 'a/~': value };
    expect(validateModel(await exampleWith(value))).toContainEqual(
      schemaIssue(
        'model.yaml',
        `/ext/k${'/a~1~0'.repeat(254)}`,
        `/ext/k${'/a~1~0'.repeat(254)} ${TOO_DEEP}`,
      ),
    );
  });

  test('one issue per item, at the first collection too deep in key order', () => {
    const data = {
      id: 'e',
      name: 'E',
      attributes: [],
      ext: { first: arrays(300), second: arrays(300), third: [arrays(260)] },
    };
    const model: Model = {
      ...emptyModel(),
      entities: [entity('a.yaml', data), entity('b.yaml', data)],
    };
    const path = `/ext/first${'/0'.repeat(254)}`;
    expect(validateModel(model)).toEqual([
      schemaIssue('a.yaml', path, `${path} ${TOO_DEEP}`),
      schemaIssue('b.yaml', path, `${path} ${TOO_DEEP}`),
    ]);
  });

  test('values that are not JSON data below the limit are still reported, the schema still checked', () => {
    const model: Model = {
      ...emptyModel(),
      entities: [
        entity('a.yaml', {
          id: 7,
          name: 'A',
          attributes: [],
          ext: { k: arrays(300, [NaN]) },
        }),
      ],
    };
    const deepPath = `/ext/k${'/0'.repeat(254)}`;
    const nanPath = `/ext/k${'/0'.repeat(300)}`;
    // Sorted by path: `/ext/…` before `/id`.
    expect(validateModel(model)).toEqual([
      schemaIssue('a.yaml', deepPath, `${deepPath} ${TOO_DEEP}`),
      schemaIssue('a.yaml', nanPath, `${nanPath} must be a JSON value`),
      schemaIssue('a.yaml', '/id', '/id must be string'),
    ]);
  });

  test(
    'a million levels deep is one issue without throwing, wherever it is in an item',
    { timeout: 60_000 },
    () => {
      const model: Model = {
        ...emptyModel(),
        entities: [
          entity('a.yaml', {
            id: 'a',
            name: 'A',
            attributes: arrays(1_000_000),
          }),
          entity('b.yaml', {
            id: 'b',
            name: 'B',
            attributes: [{ id: 'x', name: 'X', default: arrays(100_000) }],
          }),
          entity('c.yaml', arrays(100_000)),
        ],
        layouts: [
          {
            file: 'l.json',
            data: {
              formatVersion: '0.1',
              nodes: { n: arrays(100_000) },
            } as never,
          },
        ],
      };
      const tooDeep = validateModel(model).filter((issue) =>
        issue.message.endsWith(TOO_DEEP),
      );
      expect(tooDeep.map((issue) => [issue.file, issue.path])).toEqual([
        ['a.yaml', `/attributes${'/0'.repeat(255)}`],
        ['b.yaml', `/attributes/0/default${'/0'.repeat(253)}`],
        ['c.yaml', '/0'.repeat(256)],
        ['l.json', `/nodes/n${'/0'.repeat(254)}`],
      ]);
    },
  );

  test('the limit is the same for loadModel, validateModel and serializeModel: 256 levels pass all three, 257 none', async () => {
    // `k: [[…]]` in the manifest: `arrays` arrays from level 3 down.
    const files = (count: number) =>
      replaceOnce(
        exampleFiles(),
        'model.yaml',
        'targets:\n',
        `ext:\n  k: ${'['.repeat(count)}${']'.repeat(count)}\ntargets:\n`,
      );

    const atLimit = await loadModel(exampleFileSystem(files(254)), '');
    expect(atLimit.issues).toEqual([]);
    expect(atLimit.model.manifest?.data.ext).toEqual({ k: arrays(254) });
    expect(validateModel(atLimit.model, atLimit.positions)).toEqual([]);
    const text = serializeModel(atLimit.model).find(
      (file) => file.file === 'model.yaml',
    )?.text;
    const back = await loadModel(
      exampleFileSystem({ ...exampleFiles(), 'model.yaml': text ?? '' }),
      '',
    );
    expect(back.issues).toEqual([]);
    expect(back.model).toEqual(atLimit.model);

    const pastLimit = await loadModel(exampleFileSystem(files(255)), '');
    expect(pastLimit.model.manifest).toBeUndefined();
    expect(pastLimit.issues).toEqual([
      expect.objectContaining({
        rule: 'syntax',
        file: 'model.yaml',
        message: expect.stringContaining(
          `Collections are nested more than ${MAX_NESTING} levels deep`,
        ) as unknown,
      }),
    ]);
    const inMemory = await exampleWith(arrays(255));
    expect(validateModel(inMemory)).toContainEqual(
      schemaIssue('model.yaml', pathAt257, `${pathAt257} ${TOO_DEEP}`),
    );
    expect(() => serializeModel(inMemory)).toThrow(
      new TypeError(`Cannot write model.yaml: ${pathAt257} ${TOO_DEEP}`),
    );
  });
});
