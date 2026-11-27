import { Ajv2020, type AnySchemaObject } from 'ajv/dist/2020.js';
import { describe, expect, test } from 'vitest';
import { schemaFiles } from '../generated/schemas.js';
import type { Issue } from '../model/types.js';
import {
  canonicalJson,
  duplicateItems,
  type SchemaName,
  schemaAjv,
} from '../schema/ajv.js';
import { parseYaml } from '../parse/yaml.js';
import { exampleFiles } from '../testing/example.js';
import { itemIssues, schemaIssues } from './schema.js';

const FILE = 'subject-areas/party.yaml';

const issue = (path: string, message: string): Issue => ({
  rule: 'schema',
  severity: 'error',
  file: FILE,
  path,
  message,
});

/** Ajv's order is not part of the contract; `validateModel` sorts. */
const sorted = (issues: Issue[]) =>
  [...issues].sort((a, b) =>
    a.path === b.path
      ? a.message < b.message
        ? -1
        : 1
      : a.path < b.path
        ? -1
        : 1,
  );

/** Ajv as the old tool set it up, with the schemas as they are in the files. */
function nativeAjv() {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    strictSchema: true,
  });
  for (const schema of Object.values(schemaFiles)) {
    ajv.addSchema(schema as AnySchemaObject);
  }
  return ajv;
}

let native: Ajv2020 | undefined;

/** The old tool's lines (`<instancePath or "/"> <message>`) for `data`. */
function nativeMessages(name: SchemaName, data: unknown): string[] {
  native ??= nativeAjv();
  const validate = native.getSchema(`urn:erdmaker:format:0.1:${name}`);
  if (!validate) throw new Error(name);
  validate(data);
  return (validate.errors ?? [])
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .sort();
}

describe('schema issues', () => {
  test('Ajv is set up as the old tool: 2020-12, all errors, strictSchema only', () => {
    expect(schemaAjv().opts).toMatchObject({
      allErrors: true,
      strictSchema: true,
      strictTypes: false,
      strictTuples: false,
      strictRequired: false,
    });
  });

  test('message is "<instancePath or /> <Ajv message>"; an unknown key points at the key', () => {
    expect(
      sorted(
        schemaIssues(FILE, 'subject-area', {
          id: 'p',
          entities: 'x',
          'a/b~c': 1,
        }),
      ),
    ).toEqual([
      issue('', "/ must have required property 'name'"),
      issue('/a~1b~0c', '/ must NOT have additional properties'),
      issue('/entities', '/entities must be array'),
    ]);
  });

  test('nested unknown keys and the errors of a oneOf', () => {
    expect(
      sorted(
        schemaIssues(FILE, 'entity', {
          id: 'e',
          name: 'E',
          attributes: [
            { id: 'a', name: 'A', bogus: 1, default: { expr: 'x' } },
          ],
        }),
      ),
    ).toEqual([
      issue(
        '/attributes/0/bogus',
        '/attributes/0 must NOT have additional properties',
      ),
      issue(
        '/attributes/0/default',
        '/attributes/0/default must be string,number,boolean',
      ),
      issue(
        '/attributes/0/default',
        "/attributes/0/default must have required property 'expression'",
      ),
      issue(
        '/attributes/0/default',
        '/attributes/0/default must match exactly one schema in oneOf',
      ),
      issue(
        '/attributes/0/default/expr',
        '/attributes/0/default must NOT have additional properties',
      ),
    ]);
  });

  test('instance paths are escaped JSON Pointers; property name errors point at the map', () => {
    expect(
      sorted(
        schemaIssues(FILE, 'dictionary', {
          domains: [
            {
              id: 'd',
              name: 'D',
              type: { base: 'string' },
              physicalTypes: { 'a/b~c': 1 },
            },
          ],
        }),
      ),
    ).toEqual([
      issue(
        '/domains/0/physicalTypes',
        '/domains/0/physicalTypes must match pattern "^[a-z][a-z0-9]*$"',
      ),
      issue(
        '/domains/0/physicalTypes',
        '/domains/0/physicalTypes property name must be valid',
      ),
      issue(
        '/domains/0/physicalTypes/a~1b~0c',
        '/domains/0/physicalTypes/a~1b~0c must be string',
      ),
    ]);
  });

  test('a valid file has no issues', () => {
    expect(
      schemaIssues(FILE, 'subject-area', {
        id: 'p',
        name: 'P',
        entities: ['a', 'b'],
      }),
    ).toEqual([]);
  });

  test('values that are not JSON are reported, and the schema is still checked', () => {
    expect(
      sorted(
        itemIssues(FILE, 'subject-area', {
          id: 'p',
          bogus: 1,
          ext: { x: Infinity, n: NaN, big: 2 ** 60 },
        }),
      ),
    ).toEqual([
      issue('', "/ must have required property 'entities'"),
      issue('', "/ must have required property 'name'"),
      issue('/bogus', '/ must NOT have additional properties'),
      issue('/ext/big', '/ext/big must be a JSON value'),
      issue('/ext/n', '/ext/n must be a JSON value'),
      issue('/ext/x', '/ext/x must be a JSON value'),
    ]);
    expect(sorted(itemIssues(FILE, 'subject-area', { id: 'p' }))).toEqual([
      issue('', "/ must have required property 'entities'"),
      issue('', "/ must have required property 'name'"),
    ]);
  });

  test('undefined, functions, symbols and bigints are scalars to the schema check', () => {
    expect(
      sorted(
        itemIssues(FILE, 'subject-area', {
          id: 'p',
          name: undefined,
          group: () => 1,
          order: 1n,
          entities: [Symbol('e')],
        }),
      ),
    ).toEqual([
      issue('', "/ must have required property 'name'"),
      issue('/entities/0', '/entities/0 must be a JSON value'),
      issue('/entities/0', '/entities/0 must be string'),
      issue('/group', '/group must be a JSON value'),
      issue('/group', '/group must be string'),
      issue('/name', '/name must be a JSON value'),
      issue('/order', '/order must be a JSON value'),
      issue('/order', '/order must be integer'),
    ]);
    expect(sorted(itemIssues(FILE, 'subject-area', undefined))).toEqual([
      issue('', '/ must be a JSON value'),
      issue('', '/ must be object'),
    ]);
  });

  test('data that is not safe to read is not given to the schema check', () => {
    const cyclic: Record<string, unknown> = { id: 'p', bogus: 1 };
    cyclic.ext = { self: cyclic };
    const accessor = Object.defineProperty({ id: 'p', bogus: 1 }, 'name', {
      enumerable: true,
      get() {
        throw new Error('called');
      },
    });
    const sparse: unknown[] = [];
    sparse.length = 2 ** 32 - 1;
    class Area {
      id = 'p';
    }
    expect(itemIssues(FILE, 'subject-area', cyclic)).toEqual([
      issue('/ext/self', '/ext/self must be a JSON value'),
    ]);
    expect(itemIssues(FILE, 'subject-area', accessor)).toEqual([
      issue('/name', '/name must be a JSON value'),
    ]);
    expect(
      itemIssues(FILE, 'subject-area', { id: 'p', bogus: 1, entities: sparse }),
    ).toEqual([issue('/entities/0', '/entities/0 must be a JSON value')]);
    expect(itemIssues(FILE, 'subject-area', new Area())).toEqual([
      issue('', '/ must be a JSON value'),
    ]);
    expect(
      itemIssues(FILE, 'subject-area', {
        id: 'p',
        bogus: 1,
        ext: { d: new Date(0) },
      }),
    ).toEqual([issue('/ext/d', '/ext/d must be a JSON value')]);
  });

  test('data that throws when Ajv reads it is not JSON data, and nothing is thrown', () => {
    const data = new Proxy(
      { id: 'p', name: 'P', entities: [] },
      {
        get() {
          throw new Error('trap');
        },
      },
    );
    expect(itemIssues(FILE, 'subject-area', data)).toEqual([
      issue('', '/ must be a JSON value'),
    ]);
  });
});

describe('schema issues: duplicate items', () => {
  test('a subject area and a key: worded and paired as by Ajv', () => {
    expect(
      schemaIssues(FILE, 'subject-area', {
        id: 'p',
        name: 'P',
        entities: ['a', 'b', 'a', 'c', 'b'],
      }),
    ).toEqual([
      issue(
        '/entities',
        '/entities must NOT have duplicate items (items ## 1 and 4 are identical)',
      ),
    ]);
    expect(
      schemaIssues(FILE, 'entity', {
        id: 'e',
        name: 'E',
        attributes: [],
        keys: [{ id: 'pk', kind: 'primary', attributes: ['x', 'x'] }],
      }),
    ).toEqual([
      issue(
        '/keys/0/attributes',
        '/keys/0/attributes must NOT have duplicate items (items ## 0 and 1 are identical)',
      ),
    ]);
  });

  test('the same lines as Ajv with the schemas as written, where Ajv hashes items and where it does not', () => {
    const cases: [SchemaName, unknown][] = [
      [
        'subject-area',
        { id: 'p', name: 'P', entities: ['a', 'b', 'a', 'c', 'b'] },
      ],
      [
        'subject-area',
        {
          id: 'p',
          name: 'P',
          entities: ['a', 1, { k: 1, j: 2 }, 1, { j: 2, k: 1 }],
        },
      ],
      ['subject-area', { id: 'p', name: 'P', entities: [0, -0, 'x'] }],
      [
        'entity',
        {
          id: 'e',
          name: 'E',
          attributes: [],
          keys: [
            { id: 'k', kind: 'primary', attributes: ['b', 'a', 'b', 'a'] },
          ],
        },
      ],
      [
        'dictionary',
        {
          words: [
            {
              id: 'w',
              name: 'W',
              synonyms: ['a', 'b', 'a'],
              forbiddenWords: ['x', 'x'],
            },
          ],
        },
      ],
      [
        'model',
        {
          formatVersion: '0.1',
          id: 'm',
          name: 'M',
          dictionaries: ['d', 'e', 'd'],
        },
      ],
    ];
    for (const [name, data] of cases) {
      const ours = schemaIssues(FILE, name, data)
        .map((found) => found.message)
        .sort();
      expect(ours.some((message) => message.includes('duplicate items'))).toBe(
        true,
      );
      expect(ours).toEqual(nativeMessages(name, data));
    }
  });

  test("random arrays: the same pair and message as Ajv's pairwise check", () => {
    const validate = new Ajv2020({ allErrors: true }).compile({
      type: 'array',
      uniqueItems: true,
    });
    // A fixed linear congruential sequence, so a failure can be reproduced.
    let seed = 7;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const atoms: unknown[] = [
      'a',
      'b',
      '1',
      1,
      1.5,
      0,
      -0,
      true,
      false,
      null,
      [],
      [1],
      ['1'],
      {},
      { a: 1, b: [2] },
      { b: [2], a: 1 },
      { a: '1' },
    ];
    for (let run = 0; run < 3000; run += 1) {
      const items = Array.from(
        { length: next(8) },
        () => atoms[next(atoms.length)],
      );
      validate(items);
      const native = validate.errors?.[0];
      const found = duplicateItems(items);
      expect(found).toEqual(native?.params);
      if (found) {
        expect(native?.message).toBe(
          `must NOT have duplicate items (items ## ${found.j} and ${found.i} are identical)`,
        );
      }
    }
  });

  test.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'a list of strings holding %s twice: the duplicate pair, as for any other string',
    (name) => {
      for (const [synonyms, pair] of [
        [[name, name], '1 and 0'],
        [[name, 'b', name, 'c'], '2 and 0'],
        [['a', name, 'a', name], '3 and 1'],
      ] as const) {
        const data = { words: [{ id: 'w', name: 'W', synonyms }] };
        expect(schemaIssues(FILE, 'dictionary', data)).toEqual([
          issue(
            '/words/0/synonyms',
            `/words/0/synonyms must NOT have duplicate items (items ## ${pair} are identical)`,
          ),
        ]);
      }
      // A list whose items are not all strings: those are left out of the pairs, as Ajv does.
      expect(
        schemaIssues(FILE, 'model', {
          formatVersion: '0.1',
          id: 'm',
          name: 'M',
          dictionaries: [name, 1, name, 1],
        }).map((found) => found.message),
      ).toEqual([
        '/dictionaries/1 must be string',
        '/dictionaries/3 must be string',
        '/dictionaries must NOT have duplicate items (items ## 2 and 0 are identical)',
      ]);
    },
  );

  test("random lists of strings: the same pair and message as Ajv's hashed check", () => {
    const validate = new Ajv2020({ allErrors: true }).compile({
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
    });
    let seed = 11;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const atoms: unknown[] = ['a', 'b', 'c', '1', 1, null, true, 'toString'];
    for (let run = 0; run < 3000; run += 1) {
      const synonyms = Array.from(
        { length: next(8) },
        () => atoms[next(atoms.length)],
      );
      validate(synonyms);
      const native = (validate.errors ?? [])
        .filter((error) => error.keyword === 'uniqueItems')
        .map((error) => `/words/0/synonyms ${error.message}`);
      const ours = schemaIssues(FILE, 'dictionary', {
        words: [{ id: 'w', name: 'W', synonyms }],
      })
        .map((found) => found.message)
        .filter((message) => message.includes('duplicate items'));
      expect(ours).toEqual(native);
    }
  });

  test('items nested 100000 deep get a key without throwing', () => {
    let deep: unknown = 'x';
    for (let i = 0; i < 100_000; i += 1) deep = { a: [deep] };
    expect(canonicalJson(deep)).toHaveLength(100_000 * 8 + 3);
    expect(duplicateItems([deep, 'y', deep])).toEqual({ i: 2, j: 0 });
  });
});

describe('schema issues: the same as Ajv with the schemas as written', () => {
  const schemaOf = (file: string): SchemaName =>
    file === 'model.yaml'
      ? 'model'
      : file.startsWith('dictionary/')
        ? 'dictionary'
        : file.startsWith('entities/')
          ? 'entity'
          : file.startsWith('relationships/')
            ? 'relationship'
            : file.startsWith('subtypes/')
              ? 'subtype'
              : file.startsWith('subject-areas/')
                ? 'subject-area'
                : 'layout';

  /** Every container of `value` with its parent chain, as [container, key] pairs reaching it. */
  function containers(value: unknown): unknown[] {
    const found: unknown[] = [];
    const pending = [value];
    for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
      if (typeof node !== 'object' || node === null) continue;
      found.push(node);
      for (const child of Object.values(node)) pending.push(child);
    }
    return found;
  }

  const replacements: unknown[] = [
    null,
    1,
    1.5,
    -1,
    'x',
    'Not An Id',
    '',
    true,
    {},
    [],
    { bogus: 1 },
    ['a', 'a'],
    { expression: '' },
  ];

  test('every example file, changed at random 300 times each', () => {
    // A fixed linear congruential sequence, so a failure can be reproduced.
    let seed = 11;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    let failing = 0;
    for (const [file, text] of Object.entries(exampleFiles())) {
      const original: unknown = file.endsWith('.json')
        ? JSON.parse(text)
        : parseYaml(file, text).value;
      for (let run = 0; run < 300; run += 1) {
        const data = structuredClone(original);
        for (let change = 0; change < 1 + next(3); change += 1) {
          const nodes = containers(data);
          const node = nodes[next(nodes.length)] as Record<string, unknown>;
          const keys = Object.keys(node);
          const key = keys[next(keys.length)];
          const action = next(4);
          if (Array.isArray(node) && action === 0 && node.length > 0) {
            node.push(structuredClone(node[0]));
          } else if (action === 1 && key !== undefined) {
            delete node[key];
          } else if (action === 2) {
            node[`k${next(3)}`] = replacements[next(replacements.length)];
          } else if (key !== undefined) {
            node[key] = structuredClone(
              replacements[next(replacements.length)],
            );
          }
        }
        const name = schemaOf(file);
        const ours = schemaIssues(file, name, data)
          .map((found) => found.message)
          .sort();
        if (ours.length > 0) failing += 1;
        expect(ours, `${file}: ${JSON.stringify(data)}`).toEqual(
          nativeMessages(name, data),
        );
      }
    }
    // The changes do break most files.
    expect(failing).toBeGreaterThan(29 * 150);
  });
});
