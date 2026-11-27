import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';
import { createMemoryFileSystem } from '../fs/memory.js';
import { validateModel } from '../validate/index.js';
import { finishIssues } from '../validate/issues.js';
import { loadModel } from './load.js';
import { serializeModel } from './serialize.js';
import type { Model } from './types.js';

/** A model holding only the given items. */
function model(partial: Partial<Model>): Model {
  return {
    dir: '',
    entities: [],
    relationships: [],
    subtypes: [],
    subjectAreas: [],
    layouts: [],
    dictionaries: [],
    ...partial,
  };
}

/** The one written file's text. */
function written(of: Model): string {
  const files = serializeModel(of);
  expect(files).toHaveLength(1);
  return files[0]!.text;
}

const entity = (data: Record<string, unknown>, file = 'entities/e.yaml') =>
  model({ entities: [{ file, data: data as never }] });

const lines = (...rows: string[]) => `${rows.join('\n')}\n`;

/** Reads the written files back into a model, with every issue of loading and checking it. */
async function reread(of: Model) {
  const files = Object.fromEntries(
    serializeModel(of).map(({ file, text }) => [file, text]),
  );
  files['model.yaml'] ??= lines('formatVersion: "0.1"', 'id: m', 'name: M');
  const loaded = await loadModel(createMemoryFileSystem(files), '');
  const issues = finishIssues([
    ...loaded.issues,
    ...validateModel(loaded.model, loaded.positions),
  ]);
  return { model: loaded.model, issues };
}

// `uniqueKeys` compares every pair of keys; the texts here hold maps of thousands.
const parse12 = (text: string): unknown =>
  parse(text, { version: '1.2', schema: 'core', uniqueKeys: false });
const parse11 = (text: string): unknown =>
  parse(text, { version: '1.1', uniqueKeys: false });

describe('쓰기 세부', () => {
  test('(1) strings a YAML 1.1 reader would take for other types are quoted', () => {
    const strings = [
      'NO',
      'no',
      'yes',
      'on',
      'off',
      'y',
      'n',
      '~',
      'null',
      'true',
      '0.1',
      '1e3',
      '0x1F',
      '1_000',
      '1:30',
      '2001-12-14',
      '.inf',
      '<<',
      '=',
      ' lead',
      'trail ',
      ' both ',
      '',
    ];
    for (const value of strings) {
      const text = written(
        entity({ id: 'e', name: 'E', definition: value, attributes: [] }),
      );
      // Pinned: an upgrade of `yaml` that quotes differently fails here.
      expect(text).toBe(
        lines(
          'id: e',
          'name: E',
          `definition: ${JSON.stringify(value)}`,
          'attributes: []',
        ),
      );
      for (const read of [parse12, parse11]) {
        expect(read(text)).toEqual({
          id: 'e',
          name: 'E',
          definition: value,
          attributes: [],
        });
      }
    }
    // Keys follow the same rule.
    const ext = Object.fromEntries(strings.map((value) => [value, value]));
    const text = written(entity({ id: 'e', name: 'E', attributes: [], ext }));
    for (const read of [parse12, parse11]) {
      expect((read(text) as { ext: unknown }).ext).toEqual(ext);
    }
  });

  test('(1) the YAML 1.1 value key `=` and merge key `<<` are double-quoted as values, list items and keys', () => {
    // PyYAML's `safe_load` refuses a whole file with a plain `=` or `<<` value
    // (`tag:yaml.org,2002:value`, `tag:yaml.org,2002:merge`), and `<<` as a key.
    const text = written(
      entity({
        id: 'e',
        name: 'E',
        definition: '=',
        attributes: [],
        ext: { '=': '<<', '<<': '=', list: ['=', '<<'], '==': '=a' },
      }),
    );
    expect(text).toBe(
      lines(
        'id: e',
        'name: E',
        'definition: "="',
        'attributes: []',
        'ext:',
        '  "=": "<<"',
        '  "<<": "="',
        '  list:',
        '    - "="',
        '    - "<<"',
        // Only the exact keys mean anything to YAML 1.1; the rest stay plain.
        '  ==: =a',
      ),
    );
    for (const read of [parse12, parse11]) {
      expect(read(text)).toEqual({
        id: 'e',
        name: 'E',
        definition: '=',
        attributes: [],
        ext: { '=': '<<', '<<': '=', list: ['=', '<<'], '==': '=a' },
      });
    }
  });

  test('(2) a multi-line text ending in two newlines reads back the same', () => {
    const definition = 'line one\nline two\n\n';
    const text = written(
      entity({ id: 'e', name: 'E', definition, attributes: [] }),
    );
    expect(text).toBe(
      lines(
        'id: e',
        'name: E',
        'definition: |+',
        '  line one',
        '  line two',
        '',
        'attributes: []',
      ),
    );
    for (const read of [parse12, parse11]) {
      expect((read(text) as { definition: string }).definition).toBe(
        definition,
      );
    }
  });

  test('(3) an expression default is written (the oneOf branch with properties)', () => {
    const text = written(
      entity({
        id: 'e',
        name: 'E',
        attributes: [
          { id: 'a', name: 'A', default: { expression: 'now()' } },
          { id: 'b', name: 'B', default: { x: 1, expression: 'e' } },
          { id: 'c', name: 'C', default: 0 },
          { id: 'd', name: 'D', default: false },
        ],
      }),
    );
    expect(text).toBe(
      lines(
        'id: e',
        'name: E',
        'attributes:',
        '  - id: a',
        '    name: A',
        '    default:',
        '      expression: now()',
        '  - id: b',
        '    name: B',
        '    default:',
        '      expression: e',
        '      x: 1',
        '  - id: c',
        '    name: C',
        '    default: 0',
        '  - id: d',
        '    name: D',
        '    default: false',
      ),
    );
  });

  test('(4) a relationship with every optional key, given in reverse, is written in schema order', () => {
    const data = {
      ext: { b: 1, a: 2 },
      physical: { name: 'FK_X' },
      scope: 'logical',
      resolvedBy: 'res',
      referentialIntegrity: {
        childDelete: 'none',
        childUpdate: 'none',
        childInsert: 'none',
        parentDelete: 'cascade',
        parentUpdate: 'restrict',
        parentInsert: 'set-null',
      },
      parentKey: 'ak',
      cardinality: { count: 2, child: 'exactly', parent: 'zero-or-one' },
      verbPhrase: { childToParent: 'back', parentToChild: 'forth' },
      definition: 'def',
      name: 'rel',
      child: 'ch',
      parent: 'pa',
      kind: 'non-identifying',
      id: 'r1',
    };
    const text = written(
      model({
        relationships: [{ file: 'relationships/r1.yaml', data: data as never }],
      }),
    );
    expect(text).toBe(
      lines(
        'id: r1',
        'kind: non-identifying',
        'parent: pa',
        'child: ch',
        'name: rel',
        'definition: def',
        'verbPhrase:',
        '  parentToChild: forth',
        '  childToParent: back',
        'cardinality:',
        '  parent: zero-or-one',
        '  child: exactly',
        '  count: 2',
        'parentKey: ak',
        'referentialIntegrity:',
        '  parentInsert: set-null',
        '  parentUpdate: restrict',
        '  parentDelete: cascade',
        '  childInsert: none',
        '  childUpdate: none',
        '  childDelete: none',
        'resolvedBy: res',
        'scope: logical',
        'physical:',
        '  name: FK_X',
        'ext:',
        '  b: 1',
        '  a: 2',
      ),
    );
  });

  test('(5) a type from the common schema is written base, length, precision, scale', () => {
    const type = { scale: 2, precision: 10, length: 5, base: 'decimal' };
    expect(
      written(
        entity({
          id: 'e',
          name: 'E',
          attributes: [{ id: 'a', name: 'A', type }],
        }),
      ),
    ).toBe(
      lines(
        'id: e',
        'name: E',
        'attributes:',
        '  - id: a',
        '    name: A',
        '    type:',
        '      base: decimal',
        '      length: 5',
        '      precision: 10',
        '      scale: 2',
      ),
    );
    expect(
      written(
        model({
          dictionaries: [
            {
              file: 'dictionary/d.yaml',
              data: { domains: [{ type, name: 'Num', id: 'd' }] } as never,
            },
          ],
        }),
      ),
    ).toBe(
      lines(
        'domains:',
        '  - id: d',
        '    name: Num',
        '    type:',
        '      base: decimal',
        '      length: 5',
        '      precision: 10',
        '      scale: 2',
      ),
    );
  });

  test('(6) layout: node and edge ids in text order, one line per node, empty containers inline', () => {
    const data = JSON.parse(
      JSON.stringify({
        ext: { z: 1 },
        edges: {
          e2: {},
          e1: { waypoints: [], childSide: 'top', parentSide: 'left' },
          e3: {
            waypoints: [
              { y: 2, x: 1 },
              { x: 3, y: 4 },
            ],
          },
        },
        nodes: {
          '9': { width: 30, y: 2, x: 1 },
          '10': { x: 3, y: 4 },
          '2': { color: '#aabbcc', height: 5, y: 6, x: 5 },
        },
        display: { names: 'both', level: 'key' },
        subjectArea: 'sa',
        formatVersion: '0.1',
      }),
    );
    // As in any JavaScript object, the all-digit keys come first, in number order.
    expect(Object.keys(data.nodes)).toEqual(['2', '9', '10']);
    const layouts = [
      { file: 'layouts/a.json', data },
      {
        file: 'layouts/b.json',
        data: { formatVersion: '0.1', nodes: {}, edges: {} },
      },
    ] as never;
    const files = serializeModel(model({ layouts }));
    expect(files.map((file) => file.file)).toEqual([
      'layouts/a.json',
      'layouts/b.json',
    ]);
    expect(files[0]!.text).toBe(
      lines(
        '{',
        '  "formatVersion": "0.1",',
        '  "subjectArea": "sa",',
        '  "display": {',
        '    "level": "key",',
        '    "names": "both"',
        '  },',
        '  "nodes": {',
        '    "10": { "x": 3, "y": 4 },',
        '    "2": { "x": 5, "y": 6, "height": 5, "color": "#aabbcc" },',
        '    "9": { "x": 1, "y": 2, "width": 30 }',
        '  },',
        '  "edges": {',
        '    "e1": {',
        '      "parentSide": "left",',
        '      "childSide": "top",',
        '      "waypoints": []',
        '    },',
        '    "e2": {},',
        '    "e3": {',
        '      "waypoints": [{ "x": 1, "y": 2 }, { "x": 3, "y": 4 }]',
        '    }',
        '  },',
        '  "ext": {',
        '    "z": 1',
        '  }',
        '}',
      ),
    );
    expect(files[1]!.text).toBe(
      lines(
        '{',
        '  "formatVersion": "0.1",',
        '  "nodes": {},',
        '  "edges": {}',
        '}',
      ),
    );
    for (const { text } of files) expect(JSON.parse(text)).toBeTruthy();
  });

  test('(7) an object shared by two places is written twice, without anchors', async () => {
    const shared = { deep: { list: [1, 'two'] } };
    const data = {
      id: 'e',
      name: 'E',
      attributes: [{ id: 'a', name: 'A', ext: { one: shared } }],
      ext: { left: shared, right: shared },
    };
    const of = entity(data);
    const text = written(of);
    expect(text).not.toMatch(/[&*]/);
    expect(text).toBe(
      lines(
        'id: e',
        'name: E',
        'attributes:',
        '  - id: a',
        '    name: A',
        '    ext:',
        '      one:',
        '        deep:',
        '          list:',
        '            - 1',
        '            - two',
        'ext:',
        '  left:',
        '    deep:',
        '      list:',
        '        - 1',
        '        - two',
        '  right:',
        '    deep:',
        '      list:',
        '        - 1',
        '        - two',
      ),
    );
    const back = await reread(of);
    expect(back.issues).toEqual([]);
    expect(back.model.entities.map((item) => item.data)).toEqual([data]);
  });
});

describe('쓰기 세부: defaults, unknown keys, lists', () => {
  test('long lines are not folded (lineWidth 0)', () => {
    const definition = Array.from({ length: 60 }, (_, i) => `word${i}`).join(
      ' ',
    );
    const key = Array.from({ length: 30 }, (_, i) => `k${i}`).join(' ');
    const text = written(
      entity({
        id: 'e',
        name: 'E',
        definition,
        attributes: [],
        ext: { [key]: definition },
      }),
    );
    expect(text).toBe(
      lines(
        'id: e',
        'name: E',
        `definition: ${definition}`,
        'attributes: []',
        'ext:',
        `  ${key}: ${definition}`,
      ),
    );
  });

  test('a value equal to its default is left out, and so is an optional object it empties', () => {
    const files = serializeModel(
      model({
        manifest: {
          file: 'model.yaml',
          data: {
            formatVersion: '0.1',
            id: 'm',
            name: 'M',
            notation: 'ie',
            schemas: [
              { name: 's', role: 'main' },
              { name: 't', role: 'linked' },
            ],
            dictionaries: ['dictionary'],
          },
        },
        relationships: [
          {
            file: 'relationships/r.yaml',
            data: {
              id: 'r',
              kind: 'identifying',
              parent: 'p',
              child: 'c',
              verbPhrase: {},
              cardinality: { parent: 'one', child: 'zero-or-more' },
              scope: 'both',
              ext: {},
            },
          },
        ],
        entities: [
          {
            file: 'entities/e.yaml',
            data: {
              id: 'e',
              name: 'E',
              scope: 'both',
              attributes: [
                {
                  id: 'a',
                  name: 'A',
                  scope: 'both',
                  nullable: true,
                  rolenamed: false,
                },
                { id: 'b', name: 'B', nullable: false },
              ],
              keys: [
                { id: 'pk', kind: 'primary', attributes: ['a'], scope: 'both' },
              ],
            },
          },
        ],
      }),
    );
    expect(
      Object.fromEntries(files.map((file) => [file.file, file.text])),
    ).toEqual({
      'entities/e.yaml': lines(
        'id: e',
        'name: E',
        'attributes:',
        // An attribute's scope has no default: absent inherits the entity's.
        '  - id: a',
        '    name: A',
        '    scope: both',
        '  - id: b',
        '    name: B',
        '    nullable: false',
        'keys:',
        '  - id: pk',
        '    kind: primary',
        '    attributes:',
        '      - a',
      ),
      'model.yaml': lines(
        'formatVersion: "0.1"',
        'id: m',
        'name: M',
        'schemas:',
        '  - name: s',
        '  - name: t',
        '    role: linked',
      ),
      // `cardinality` held only defaults; `verbPhrase` and `ext` were empty already.
      'relationships/r.yaml': lines(
        'id: r',
        'kind: identifying',
        'parent: p',
        'child: c',
        'verbPhrase: {}',
        'ext: {}',
      ),
    });
  });

  test('a default is compared as data: another list is written', () => {
    const text = written(
      model({
        manifest: {
          file: 'model.yaml',
          data: {
            formatVersion: '0.1',
            id: 'm',
            name: 'M',
            dictionaries: ['dictionary', 'other'],
          },
        },
      }),
    );
    expect(text).toBe(
      lines(
        'formatVersion: "0.1"',
        'id: m',
        'name: M',
        'dictionaries:',
        '  - dictionary',
        '  - other',
      ),
    );
  });

  test('keys the schema does not have come after its keys, in their order', () => {
    const data: Record<string, unknown> = {};
    for (const [key, value] of [
      ['zz', 1],
      ['attributes', []],
      ['aa', { b: 1, a: 2 }],
      ['name', 'E'],
      ['id', 'e'],
    ] as const) {
      data[key] = value;
    }
    expect(written(entity(data))).toBe(
      lines(
        'id: e',
        'name: E',
        'attributes: []',
        'zz: 1',
        'aa:',
        '  b: 1',
        '  a: 2',
      ),
    );
  });

  test('ext and physicalTypes keep their order; ext holds defaults as given', () => {
    const text = written(
      entity({
        id: 'e',
        name: 'E',
        attributes: [
          {
            id: 'a',
            name: 'A',
            physical: { types: { mysql: 'int', postgresql: 'integer' } },
            ext: { nullable: true, scope: 'both', z: {}, a: [] },
          },
        ],
      }),
    );
    expect(text).toBe(
      lines(
        'id: e',
        'name: E',
        'attributes:',
        '  - id: a',
        '    name: A',
        '    physical:',
        '      types:',
        '        mysql: int',
        '        postgresql: integer',
        '    ext:',
        '      nullable: true',
        '      scope: both',
        '      z: {}',
        '      a: []',
      ),
    );
  });

  test('subject area entities are sorted by code unit; no other list is', () => {
    const files = serializeModel(
      model({
        subjectAreas: [
          {
            file: 'subject-areas/s.yaml',
            data: { id: 's', name: 'S', entities: ['b', 'a', '2', '10', 'B'] },
          },
        ],
        subtypes: [
          {
            file: 'subtypes/t.yaml',
            data: {
              id: 't',
              supertype: 'p',
              members: [
                { id: 'z', entity: 'z' },
                { id: 'a', entity: 'a' },
              ],
            },
          },
        ],
      }),
    );
    expect(files.map((file) => file.text)).toEqual([
      lines(
        'id: s',
        'name: S',
        'entities:',
        '  - "10"',
        '  - "2"',
        '  - B',
        '  - a',
        '  - b',
      ),
      lines(
        'id: t',
        'supertype: p',
        'members:',
        '  - id: z',
        '    entity: z',
        '  - id: a',
        '    entity: a',
      ),
    ]);
  });

  test('__proto__ keys are written as keys, in YAML and in JSON', async () => {
    const ext = JSON.parse('{"__proto__": {"x": 1}, "b": 2}');
    expect(Object.keys(ext)).toEqual(['__proto__', 'b']);
    const nodes = JSON.parse(
      '{"b": {"x": 1, "y": 2}, "__proto__": {"y": 4, "x": 3}}',
    );
    const of = model({
      entities: [
        {
          file: 'entities/e.yaml',
          data: { id: 'e', name: 'E', attributes: [], ext },
        },
      ],
      layouts: [
        { file: 'layouts/l.json', data: { formatVersion: '0.1', nodes, ext } },
      ],
    });
    const files = serializeModel(of);
    expect(files.map((file) => file.text)).toEqual([
      lines(
        'id: e',
        'name: E',
        'attributes: []',
        'ext:',
        '  __proto__:',
        '    x: 1',
        '  b: 2',
      ),
      lines(
        '{',
        '  "formatVersion": "0.1",',
        '  "nodes": {',
        '    "__proto__": { "x": 3, "y": 4 },',
        '    "b": { "x": 1, "y": 2 }',
        '  },',
        '  "ext": {',
        '    "__proto__": {',
        '      "x": 1',
        '    },',
        '    "b": 2',
        '  }',
        '}',
      ),
    ]);
    const files2 = {
      [files[0]!.file]: files[0]!.text,
      'model.yaml': lines('formatVersion: "0.1"', 'id: m', 'name: M'),
    };
    const loaded = await loadModel(createMemoryFileSystem(files2), '');
    expect(loaded.issues).toEqual([]);
    expect(Object.getPrototypeOf(loaded.model.entities[0]!.data.ext)).toBe(
      Object.prototype,
    );
    expect(loaded.model.entities[0]!.data.ext).toEqual(ext);
    // Not a valid node id, so the layout is checked as JSON text only.
    const layout = JSON.parse(files[1]!.text);
    expect(Object.keys(layout.nodes)).toEqual(['__proto__', 'b']);
    expect(Object.getPrototypeOf(layout.nodes)).toBe(Object.prototype);
    expect(layout.ext).toEqual(ext);
  });

  test('files come in code unit order of their paths, each at its item path', () => {
    const data = { id: 'e', name: 'E', attributes: [] };
    const files = serializeModel(
      model({
        entities: [
          { file: 'entities/b.yaml', data },
          { file: 'entities/B.yaml', data },
          { file: 'entities/a/z.yaml', data },
        ],
        dictionaries: [{ file: '../shared/d.yaml', data: {} }],
        manifest: {
          file: 'model.yaml',
          data: { formatVersion: '0.1', id: 'm', name: 'M' },
        },
      }),
    );
    expect(files.map((file) => file.file)).toEqual([
      '../shared/d.yaml',
      'entities/B.yaml',
      'entities/a/z.yaml',
      'entities/b.yaml',
      'model.yaml',
    ]);
    expect(files[0]!.text).toBe('{}\n');
  });

  test('the model is not changed', () => {
    const data = {
      id: 'e',
      name: 'E',
      scope: 'both',
      attributes: [{ nullable: true, name: 'A', id: 'a' }],
    };
    const of = entity(data);
    const before = JSON.stringify(of);
    serializeModel(of);
    expect(JSON.stringify(of)).toBe(before);
  });

  test('numbers: -0, large safe integers, exponents', async () => {
    const ext = {
      zero: -0,
      big: Number.MAX_SAFE_INTEGER,
      small: -Number.MAX_SAFE_INTEGER,
      tiny: 1.5e-7,
      negative: -2.5e-300,
      float: 0.1,
    };
    const of = model({
      entities: [
        {
          file: 'entities/e.yaml',
          data: { id: 'e', name: 'E', attributes: [], ext },
        },
      ],
      layouts: [
        {
          file: 'layouts/l.json',
          data: {
            formatVersion: '0.1',
            nodes: { e: { x: -0, y: -5 } },
            ext,
          } as never,
        },
      ],
    });
    const files = serializeModel(of);
    expect(files[0]!.text).toBe(
      lines(
        'id: e',
        'name: E',
        'attributes: []',
        'ext:',
        '  zero: -0',
        '  big: 9007199254740991',
        '  small: -9007199254740991',
        '  tiny: 1.5e-7',
        '  negative: -2.5e-300',
        '  float: 0.1',
      ),
    );
    expect(files[1]!.text).toContain('"e": { "x": -0, "y": -5 }');
    expect(files[1]!.text).toContain('"tiny": 1.5e-7,');
    const back = await reread(of);
    expect(back.issues).toEqual([]);
    expect(Object.is(back.model.entities[0]!.data.ext!.zero, -0)).toBe(true);
    expect(Object.is(back.model.layouts[0]!.data.nodes.e!.x, -0)).toBe(true);
    expect(back.model.entities[0]!.data.ext).toEqual(ext);
    expect(back.model.layouts[0]!.data.ext).toEqual(ext);
  });
});

describe('serializeModel: what it refuses', () => {
  const attributeDefault = (value: unknown) =>
    entity({
      id: 'e',
      name: 'E',
      attributes: [{ id: 'a', name: 'A', default: value }],
    });

  test('data that is not JSON data throws, naming the file and the value', () => {
    class Point {
      x = 1;
    }
    const sparse = [1];
    sparse[2] = 3;
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const accessor = {};
    Object.defineProperty(accessor, 'x', { get: () => 1, enumerable: true });
    const values: unknown[] = [
      Infinity,
      -Infinity,
      NaN,
      2 ** 53,
      1e300,
      undefined,
      () => 1,
      Symbol('s'),
      10n,
      new Date(0),
      new Uint8Array(2),
      new Point(),
      cycle,
      sparse,
      accessor,
    ];
    for (const value of values) {
      const of = attributeDefault(value);
      expect(
        validateModel(of).filter((issue) =>
          issue.message.endsWith('must be a JSON value'),
        ),
      ).not.toEqual([]);
      expect(() => serializeModel(of)).toThrow(TypeError);
      expect(() => serializeModel(of)).toThrow(
        /^Cannot write entities\/e\.yaml: \/attributes\/0\/default(\/\w+)? must be a JSON value$/,
      );
    }
    const missing = model({ entities: [{ file: 'entities/e.yaml' } as never] });
    expect(() => serializeModel(missing)).toThrow(
      'Cannot write entities/e.yaml: / must be a JSON value',
    );
  });

  test('JSON data that fails the schemas is written as it is', () => {
    const data: unknown[] = [
      {},
      { id: 'NOT AN ID', attributes: 'none', extra: [1, { b: 2 }] },
      'just text',
      'two newlines last\n\n',
      null,
      [1, 'two'],
      42,
    ];
    const texts = data.map((value) =>
      written(
        model({
          entities: [{ file: 'entities/e.yaml', data: value as never }],
        }),
      ),
    );
    expect(texts).toEqual([
      '{}\n',
      lines('id: NOT AN ID', 'attributes: none', 'extra:', '  - 1', '  - b: 2'),
      'just text\n',
      '"two newlines last\\n\\n"\n',
      'null\n',
      lines('- 1', '- two'),
      '42\n',
    ]);
    for (const [index, text] of texts.entries()) {
      expect(parse12(text)).toEqual(data[index]);
    }
    expect(
      serializeModel(
        model({ layouts: [{ file: 'layouts/l.json', data: 'text' as never }] }),
      )[0]!.text,
    ).toBe('"text"\n');
  });

  /** An object nested `levels` deep, the outermost first: `{ a: { a: … {} } }`. */
  const nested = (levels: number): Record<string, unknown> => {
    let value: Record<string, unknown> = {};
    for (let level = 1; level < levels; level += 1) value = { a: value };
    return value;
  };

  test('data nested as deep as a file may (256 collections) is written and reads back', async () => {
    // The entity is the first collection, `ext` the second.
    const ext = nested(255);
    const of = model({
      entities: [
        {
          file: 'entities/e.yaml',
          data: { id: 'e', name: 'E', attributes: [], ext } as never,
        },
      ],
      layouts: [
        {
          file: 'layouts/l.json',
          data: {
            formatVersion: '0.1',
            nodes: { e: { x: 1, y: 2 } },
            ext,
          } as never,
        },
      ],
    });
    const back = await reread(of);
    expect(back.issues).toEqual([]);
    expect(back.model.entities[0]!.data.ext).toEqual(ext);
    expect(back.model.layouts[0]!.data.ext).toEqual(ext);
  });

  test('data nested deeper than a file may throws, without overflowing the stack', () => {
    const path = `/ext${'/a'.repeat(255)}`;
    for (const levels of [256, 100_000]) {
      const ext = nested(levels);
      for (const of of [
        entity({ id: 'e', name: 'E', attributes: [], ext }),
        model({
          layouts: [
            {
              file: 'entities/e.yaml',
              data: { formatVersion: '0.1', nodes: {}, ext } as never,
            },
          ],
        }),
      ]) {
        expect(() => serializeModel(of)).toThrow(
          new TypeError(
            `Cannot write entities/e.yaml: ${path} is nested more than 256 levels deep`,
          ),
        );
      }
    }
    // Arrays count as collections too.
    let list: unknown = [];
    for (let level = 2; level <= 256; level += 1) list = [list];
    expect(() =>
      written(entity({ id: 'e', name: 'E', attributes: [], ext: { list } })),
    ).toThrow('is nested more than 256 levels deep');
  });

  test('an item whose file names no file is refused, not written', () => {
    const data = { id: 'e', name: 'E', attributes: [] };
    for (const file of ['', '.', './', '/', 'entities/..']) {
      expect(() =>
        serializeModel(model({ entities: [{ file, data: data as never }] })),
      ).toThrow(
        new TypeError(
          `Cannot write entities[0]: its file ${JSON.stringify(file)} names no file`,
        ),
      );
    }
    expect(() =>
      serializeModel(
        model({
          manifest: { file: '', data: { formatVersion: '0.1' } as never },
        }),
      ),
    ).toThrow(
      new TypeError('Cannot write manifest: its file "" names no file'),
    );
  });

  test('every condition serializeModel detects throws a TypeError', () => {
    const data = { id: 'e', name: 'E', attributes: [] };
    let deep: unknown = [];
    for (let level = 0; level < 300; level += 1) deep = [deep];
    const refused: [string, unknown][] = [
      [
        'not JSON data',
        model({
          entities: [
            { file: 'e.yaml', data: { ...data, ext: { n: NaN } } as never },
          ],
        }),
      ],
      [
        'a cycle',
        (() => {
          const cyclic: Record<string, unknown> = { ...data };
          cyclic.ext = { self: cyclic };
          return model({
            entities: [{ file: 'e.yaml', data: cyclic as never }],
          });
        })(),
      ],
      [
        'nested too deep',
        model({
          entities: [
            { file: 'e.yaml', data: { ...data, ext: { deep } } as never },
          ],
        }),
      ],
      ['a model that is not an object', 7],
      ['a model that is null', null],
      ['a list that is not an array', model({ layouts: {} as never })],
      ['an item that is not an object', model({ subtypes: ['x' as never] })],
      [
        'a file that is not a string',
        model({ entities: [{ file: 1, data } as never] }),
      ],
      [
        'an empty file',
        model({ entities: [{ file: '', data: data as never }] }),
      ],
      [
        'a file of `.`',
        model({ entities: [{ file: '.', data: data as never }] }),
      ],
      [
        'two items at the same file',
        model({
          entities: [{ file: 'a.yaml', data: data as never }],
          relationships: [{ file: './a.yaml', data: {} as never }],
        }),
      ],
    ];
    for (const [name, of] of refused) {
      let thrown: unknown;
      try {
        serializeModel(of as Model);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, name).toBeInstanceOf(TypeError);
      expect((thrown as Error).message, name).toMatch(/^Cannot write /);
    }
  });

  test('a model not shaped as one throws', () => {
    const data = { id: 'e', name: 'E', attributes: [] };
    expect(() => serializeModel(null as never)).toThrow(TypeError);
    expect(() => serializeModel(model({ entities: 'x' as never }))).toThrow(
      'Cannot write entities: not a list',
    );
    expect(() => serializeModel(model({ entities: [null as never] }))).toThrow(
      'Cannot write entities[0]: not an item',
    );
    expect(() =>
      serializeModel(model({ entities: [{ data } as never] })),
    ).toThrow('Cannot write entities[0]: its file is not a path');
    expect(() =>
      serializeModel(
        model({
          entities: [
            { file: 'entities/a.yaml', data },
            { file: 'entities/./a.yaml', data },
          ],
        }),
      ),
    ).toThrow(
      'Cannot write entities/./a.yaml: entities/a.yaml is the same file',
    );
    // A list left out is an empty one, as `validateModel` reads it.
    expect(serializeModel({ dir: '' } as Model)).toEqual([]);
  });
});

describe('쓰기 세부: the last value ending in newlines', () => {
  /** An entity whose last value, `attributes[0].note`, is `note`. */
  const last = (note: string) =>
    entity({ id: 'e', name: 'E', attributes: [{ id: 'a', name: 'A', note }] });

  test('(8) a last value ending in two or more newlines is an escaped double-quoted scalar', () => {
    for (const [note, line] of [
      ['a\nb\n\n', '    note: "a\\nb\\n\\n"'],
      ['a\n\n', '    note: "a\\n\\n"'],
      ['\n\n', '    note: "\\n\\n"'],
      ['a\n\n\n', '    note: "a\\n\\n\\n"'],
      [' lead\n\n', '    note: " lead\\n\\n"'],
    ] as const) {
      const text = written(last(note));
      expect(text.endsWith('\n')).toBe(true);
      expect(text.at(-2)).not.toBe('\n');
      expect(text).toBe(
        lines(
          'id: e',
          'name: E',
          'attributes:',
          '  - id: a',
          '    name: A',
          line,
        ),
      );
      for (const read of [parse12, parse11]) {
        const back = read(text) as { attributes: { note: string }[] };
        expect(back.attributes[0]!.note).toBe(note);
      }
    }
  });

  test('a long double-quoted text stays on one line and reads back the same', () => {
    // `yaml` would break these at their newlines and, for the second, write `\\ ` for the space.
    const long = 'x'.repeat(50);
    for (const [note, line] of [
      [`${long}\n\n`, `    note: "${long}\\n\\n"`],
      [
        `+0\n \nback\\slash ${long}\n\n\n`,
        `    note: "+0\\n\\ \\nback\\\\slash ${long}\\n\\n\\n"`,
      ],
    ] as const) {
      const text = written(last(note));
      expect(text).toBe(
        lines(
          'id: e',
          'name: E',
          'attributes:',
          '  - id: a',
          '    name: A',
          line,
        ),
      );
      for (const read of [parse12, parse11]) {
        const back = read(text) as { attributes: { note: string }[] };
        expect(back.attributes[0]!.note).toBe(note);
      }
    }
    // Not only as the last value: text with a control character is double-quoted anywhere.
    const value = `\u0007${long}\n \nend`;
    const text = written(
      entity({ id: 'e', name: 'E', definition: value, attributes: [] }),
    );
    expect(text).toBe(
      lines(
        'id: e',
        'name: E',
        `definition: "\\a${long}\\n\\ \\nend"`,
        'attributes: []',
      ),
    );
    expect((parse12(text) as { definition: string }).definition).toBe(value);
  });

  test('the same text elsewhere stays a block scalar and reads back the same', () => {
    const note = 'a\nb\n\n';
    const text = written(
      entity({
        id: 'e',
        name: 'E',
        attributes: [{ id: 'a', name: 'A', note }],
        ext: { after: 1 },
      }),
    );
    expect(text).toBe(
      lines(
        'id: e',
        'name: E',
        'attributes:',
        '  - id: a',
        '    name: A',
        '    note: |+',
        '      a',
        '      b',
        '',
        'ext:',
        '  after: 1',
      ),
    );
    for (const read of [parse12, parse11]) {
      const back = read(text) as { attributes: { note: string }[] };
      expect(back.attributes[0]!.note).toBe(note);
    }
  });

  test('one trailing newline, or none, keeps the block scalar at the end', () => {
    expect(written(last('a\nb\n'))).toBe(
      lines(
        'id: e',
        'name: E',
        'attributes:',
        '  - id: a',
        '    name: A',
        '    note: |',
        '      a',
        '      b',
      ),
    );
    expect(written(last('a\nb'))).toBe(
      lines(
        'id: e',
        'name: E',
        'attributes:',
        '  - id: a',
        '    name: A',
        '    note: |-',
        '      a',
        '      b',
      ),
    );
  });

  test('the last value is found through lists and maps, and a last key is never a block', () => {
    const text = written(
      entity({
        id: 'e',
        name: 'E',
        attributes: [],
        ext: { list: [{ k: ['x\n\n'] }] },
      }),
    );
    expect(text).toBe(
      lines(
        'id: e',
        'name: E',
        'attributes: []',
        'ext:',
        '  list:',
        '    - k:',
        '        - "x\\n\\n"',
      ),
    );
    expect(
      written(
        entity({ id: 'e', name: 'E', attributes: [], ext: { 'x\n\n': [] } }),
      ),
    ).toBe(
      lines('id: e', 'name: E', 'attributes: []', 'ext:', '  "x\\n\\n": []'),
    );
  });
});

describe(
  '쓰기 세부: every short text of spaces, tabs and line ends reads back',
  { timeout: 60_000 },
  () => {
    /** Every string of up to `length` characters from `alphabet`. */
    const strings = (alphabet: string[], length: number): string[] => {
      const out = [''];
      for (let start = 0; start < out.length; start += 1) {
        if (out[start]!.length < length) {
          for (const char of alphabet) out.push(out[start]! + char);
        }
      }
      return out;
    };
    const all = strings([' ', '\t', '\n', 'a', '#'], 6);

    test('as values, list items and keys, in YAML 1.2 core and 1.1', async () => {
      expect(all).toHaveLength(19_531);
      const ext: Record<string, unknown> = {
        list: all,
        nested: all.map((value) => ({ value })),
        keys: Object.fromEntries(all.map((value, index) => [value, index])),
      };
      const of = entity({ id: 'e', name: 'E', attributes: [], ext });
      const text = written(of);
      for (const read of [parse12, parse11]) {
        expect((read(text) as { ext: unknown }).ext).toEqual(ext);
      }
      const back = await reread(of);
      expect(back.issues).toEqual([]);
      expect(back.model.entities[0]!.data.ext).toEqual(ext);
    });

    test('as the last value of a file', () => {
      for (const value of all.filter((text) => text.includes('\n'))) {
        const text = written(
          entity({ id: 'e', name: 'E', attributes: [], ext: { value } }),
        );
        expect(
          text.endsWith('\n') && !text.endsWith('\n\n'),
          JSON.stringify(value),
        ).toBe(true);
        expect((parse12(text) as { ext: unknown }).ext).toEqual({ value });
      }
    });

    test('a text of blank lines only is double-quoted wherever it is', () => {
      expect(
        written(
          entity({
            id: 'e',
            name: 'E',
            attributes: [],
            ext: { a: ' \n\n\n', b: '\n', c: 1 },
          }),
        ),
      ).toBe(
        lines(
          'id: e',
          'name: E',
          'attributes: []',
          'ext:',
          '  a: "\\ \\n\\n\\n"',
          '  b: "\\n"',
          '  c: 1',
        ),
      );
    });
  },
);
