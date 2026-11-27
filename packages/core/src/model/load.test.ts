import { describe, expect, test } from 'vitest';
import { FileNotFoundError } from '../fs/adapter.js';
import {
  exampleFileSystem,
  exampleFiles,
  type Files,
  replaceOnce,
} from '../testing/example.js';
import { validateModel } from '../validate/index.js';
import { finishIssues } from '../validate/issues.js';
import type { Issue } from './types.js';
import { ABSOLUTE_MESSAGE, COMMENT_MESSAGE, loadModel } from './load.js';

const PARTY = 'subject-areas/party.yaml';

/** The example with each `[search, replacement]` applied once to `subject-areas/party.yaml`. */
function party(...changes: [string, string][]): Files {
  return changes.reduce(
    (files, [search, replacement]) =>
      replaceOnce(files, PARTY, search, replacement),
    exampleFiles(),
  );
}

/** Reads the files from disk-like memory and validates the model, as `validateProject` does. */
async function check(files: Files) {
  const loaded = await loadModel(exampleFileSystem(files), '');
  const issues = finishIssues([
    ...loaded.issues,
    ...validateModel(loaded.model, loaded.positions),
  ]);
  return { ...loaded, issues };
}

const partyIssue = (
  rule: Issue['rule'],
  path: string,
  line: number,
  column: number,
  message: string,
): Issue => ({
  rule,
  severity: rule === 'comment' ? 'warning' : 'error',
  file: PARTY,
  path,
  line,
  column,
  message,
});

const areaFiles = (result: Awaited<ReturnType<typeof check>>) =>
  result.model.subjectAreas.map((item) => item.file);

describe('문법과 스키마', () => {
  test('the example has no issues, warnings included', async () => {
    const result = await check(exampleFiles());
    expect(result.issues).toEqual([]);
    expect(areaFiles(result)).toEqual([
      'subject-areas/catalog.yaml',
      PARTY,
      'subject-areas/sales.yaml',
    ]);
  });

  test('the dictionary abbreviation "NO" is the string NO', async () => {
    const { model } = await check(exampleFiles());
    expect(
      model.dictionaries[0]?.data.words?.map((word) => word.abbreviation),
    ).toEqual(['CUST', 'ORD', 'NO', 'NM', 'DTM']);
  });

  // Each case also adds an unknown key: a file with a YAML feature gets no schema check.
  test.each<[string, [string, string][], Issue[]]>([
    [
      'an anchor',
      [['group: master\n', 'group: &g master\nbogus: 1\n']],
      [partyIssue('yaml-feature', '', 3, 8, 'YAML anchors are not allowed')],
    ],
    [
      'an alias',
      [['name: 고객\n', 'name: &n 고객\ndefinition: *n\nbogus: 1\n']],
      [
        partyIssue('yaml-feature', '', 2, 7, 'YAML anchors are not allowed'),
        partyIssue('yaml-feature', '', 3, 13, 'YAML aliases are not allowed'),
      ],
    ],
    [
      'an alias that resolves to nothing',
      [['group: master\n', 'group: *nowhere\nbogus: 1\n']],
      [partyIssue('yaml-feature', '', 3, 8, 'YAML aliases are not allowed')],
    ],
    [
      'a !custom tag',
      [['group: master\n', 'group: !custom master\nbogus: 1\n']],
      [partyIssue('yaml-feature', '', 3, 8, 'YAML tag !custom is not allowed')],
    ],
    [
      'a !!binary tag',
      [['group: master\n', 'group: !!binary bWFzdGVy\nbogus: 1\n']],
      [
        partyIssue(
          'yaml-feature',
          '',
          3,
          8,
          'YAML tag tag:yaml.org,2002:binary is not allowed',
        ),
      ],
    ],
    [
      'a tag declared with %TAG',
      [
        ['id: party\n', '%TAG !e! tag:example.com,2000:app/\n---\nid: party\n'],
        ['group: master\n', 'group: !e!area master\nbogus: 1\n'],
      ],
      [
        partyIssue(
          'yaml-feature',
          '',
          5,
          8,
          'YAML tag tag:example.com,2000:app/area is not allowed',
        ),
      ],
    ],
  ])(
    '%s: yaml-feature only, and the file is not in the model',
    async (_name, changes, expected) => {
      const result = await check(party(...changes));
      expect(result.issues).toEqual(expected);
      expect(areaFiles(result)).toEqual([
        'subject-areas/catalog.yaml',
        'subject-areas/sales.yaml',
      ]);
      expect(result.positions.has(PARTY)).toBe(false);
    },
  );

  test.each<[string, [string, string][], Issue[]]>([
    [
      'a duplicate key',
      [['group: master\n', 'group: master\nname: 다른\n']],
      [
        partyIssue(
          'syntax',
          '',
          4,
          1,
          'Map keys must be unique at line 4, column 1:',
        ),
      ],
    ],
    [
      'true and "true" as keys in ext',
      [['group: master\n', 'group: master\next:\n  true: 1\n  "true": 2\n']],
      [partyIssue('syntax', '', 6, 3, 'Map keys collide as "true"')],
    ],
    [
      'a collection as a map key',
      [['group: master\n', 'group: master\next:\n  ? [a, b]\n  : 1\n']],
      [partyIssue('syntax', '', 5, 5, 'Map keys must be scalars')],
    ],
    [
      'an unknown key',
      [['group: master\n', 'group: master\ncolor: red\n']],
      [
        partyIssue(
          'schema',
          '/color',
          4,
          1,
          '/ must NOT have additional properties',
        ),
      ],
    ],
    [
      'a missing required key',
      [['name: 고객\n', '']],
      [partyIssue('schema', '', 1, 1, "/ must have required property 'name'")],
    ],
    [
      '.inf in ext',
      [['group: master\n', 'group: master\next:\n  x: .inf\n']],
      [partyIssue('schema', '/ext/x', 5, 3, '/ext/x must be a JSON value')],
    ],
    [
      '9007199254740993 and 1e300 in ext',
      [
        [
          'group: master\n',
          'group: master\next:\n  big: 9007199254740993\n  huge: 1e300\n',
        ],
      ],
      [
        partyIssue('schema', '/ext/big', 5, 3, '/ext/big must be a JSON value'),
        partyIssue(
          'schema',
          '/ext/huge',
          6,
          3,
          '/ext/huge must be a JSON value',
        ),
      ],
    ],
  ])('%s: the file is not in the model', async (_name, changes, expected) => {
    const result = await check(party(...changes));
    expect(result.issues).toEqual(expected);
    expect(areaFiles(result)).toEqual([
      'subject-areas/catalog.yaml',
      'subject-areas/sales.yaml',
    ]);
    expect(result.positions.has(PARTY)).toBe(false);
  });

  test('a value that is not JSON does not hide the schema errors of its file', async () => {
    const file = 'entities/zz.yaml';
    const result = await check({
      ...exampleFiles(),
      [file]: 'id: zz\nbogus: 1\nattributes: []\next:\n  x: .inf\n',
    });
    const at = (
      path: string,
      line: number,
      column: number,
      message: string,
    ) => ({
      rule: 'schema',
      severity: 'error',
      file,
      path,
      line,
      column,
      message,
    });
    expect(result.issues).toEqual([
      at('', 1, 1, "/ must have required property 'name'"),
      at('/bogus', 2, 1, '/ must NOT have additional properties'),
      at('/ext/x', 5, 3, '/ext/x must be a JSON value'),
    ]);
    expect(result.model.entities.map((item) => item.file)).not.toContain(file);
  });

  test('a comment line gives one comment warning, and the file is in the model', async () => {
    const result = await check(
      party(['group: master\n', 'group: master\n# 고객 영역\n']),
    );
    expect(result.issues).toEqual([
      partyIssue('comment', '', 4, 1, COMMENT_MESSAGE),
    ]);
    expect(areaFiles(result)).toEqual([
      'subject-areas/catalog.yaml',
      PARTY,
      'subject-areas/sales.yaml',
    ]);
  });

  // The warning is only for files in the model. The first three fail if it is
  // given before the checks; after a parser error `parseYaml` looks for no comment.
  test.each<[string, [string, string][], Issue[]]>([
    [
      'an unknown key (schema)',
      [['group: master\n', 'group: master\n# 고객 영역\ncolor: red\n']],
      [
        partyIssue(
          'schema',
          '/color',
          5,
          1,
          '/ must NOT have additional properties',
        ),
      ],
    ],
    [
      'an anchor (yaml-feature)',
      [['group: master\n', 'group: &g master\n# 고객 영역\n']],
      [partyIssue('yaml-feature', '', 3, 8, 'YAML anchors are not allowed')],
    ],
    [
      'colliding keys (syntax, found after the parser)',
      [
        [
          'group: master\n',
          'group: master\n# 고객 영역\next:\n  true: 1\n  "true": 2\n',
        ],
      ],
      [partyIssue('syntax', '', 7, 3, 'Map keys collide as "true"')],
    ],
    [
      'a duplicate key (syntax, from the parser)',
      [['group: master\n', 'group: master\n# 고객 영역\nname: 다른\n']],
      [
        partyIssue(
          'syntax',
          '',
          5,
          1,
          'Map keys must be unique at line 5, column 1:',
        ),
      ],
    ],
  ])(
    'a comment in a file left out for %s gives no comment warning',
    async (_name, changes, expected) => {
      const result = await check(party(...changes));
      expect(result.issues).toEqual(expected);
      expect(areaFiles(result)).not.toContain(PARTY);
    },
  );
});

const ENTITY = (id: string) => `id: ${id}\nname: ${id}\nattributes: []\n`;

/** The example with the dictionary file moved to `../shared/` and model.yaml pointing there. */
function sharedDictionary(manifestChange = 'dictionaries:\n  - ../shared\n') {
  const files = replaceOnce(
    exampleFiles(),
    'model.yaml',
    'targets:\n',
    `${manifestChange}targets:\n`,
  );
  const dictionary = files['dictionary/standard.yaml'] ?? '';
  delete files['dictionary/standard.yaml'];
  return { ...files, '../shared/standard.yaml': dictionary };
}

describe('what loadModel reads', () => {
  test('subfolders too, each folder by name in code units, only files with the extension', async () => {
    const files: Files = {
      ...exampleFiles(),
      'entities/Zeta.yaml': ENTITY('zeta'),
      'entities/b.yaml': ENTITY('extra_b'),
      'entities/b/x.yaml': ENTITY('extra_x'),
      'entities/b/c/y.yaml': ENTITY('extra_y'),
      'entities/a.yml': ENTITY('not_read'),
      'entities/notes.txt': 'x',
      'layouts/notes.yaml': ENTITY('not_read'),
    };
    const memory = exampleFileSystem(files);
    // An adapter that lists in reverse: the order is the reader's own.
    const fs = {
      ...memory,
      list: async (dir: string) => (await memory.list(dir)).reverse(),
    };
    const { model, issues } = await loadModel(fs, '');
    expect(issues).toEqual([]);
    expect(model.entities.map((item) => item.file)).toEqual([
      'entities/Zeta.yaml',
      'entities/address.yaml',
      'entities/b/c/y.yaml',
      'entities/b/x.yaml',
      'entities/b.yaml',
      'entities/category.yaml',
      'entities/corporate_customer.yaml',
      'entities/customer.yaml',
      'entities/order.yaml',
      'entities/order_item.yaml',
      'entities/personal_customer.yaml',
      'entities/product.yaml',
      'entities/product_tag.yaml',
      'entities/tag.yaml',
    ]);
    expect(model.layouts.map((item) => item.file)).toEqual([
      'layouts/catalog.json',
      'layouts/sales.json',
    ]);
  });

  test('a model in a subfolder: paths are relative to the opened folder', async () => {
    const files = Object.fromEntries(
      Object.entries(exampleFiles()).map(([path, text]) => [
        `shop/${path}`,
        text,
      ]),
    );
    const { model, issues, positions } = await loadModel(
      exampleFileSystem(files),
      'shop',
    );
    expect(issues).toEqual([]);
    expect(model.dir).toBe('shop');
    expect(model.manifest?.file).toBe('shop/model.yaml');
    expect(model.dictionaries.map((item) => item.file)).toEqual([
      'shop/dictionary/standard.yaml',
    ]);
    expect(model.subjectAreas[1]?.file).toBe(`shop/${PARTY}`);
    expect(positions.get(`shop/${PARTY}`)?.get('/entities/1')).toEqual({
      line: 6,
      column: 5,
    });
    expect([...positions.keys()]).toHaveLength(29);
  });

  test('every file goes in the model as read, with its position index', async () => {
    const { model, positions } = await loadModel(exampleFileSystem(), '');
    const files = [
      model.manifest,
      ...model.dictionaries,
      ...model.entities,
      ...model.relationships,
      ...model.subtypes,
      ...model.subjectAreas,
      ...model.layouts,
    ].map((item) => item?.file);
    expect([...files].sort()).toEqual(Object.keys(exampleFiles()));
    expect([...positions.keys()].sort()).toEqual(Object.keys(exampleFiles()));
    expect(model.subjectAreas[1]?.data).toEqual({
      id: 'party',
      name: '고객',
      group: 'master',
      entities: [
        'address',
        'corporate_customer',
        'customer',
        'personal_customer',
      ],
    });
    expect(model.manifest?.data.notation).toBeUndefined();
    expect(positions.get(PARTY)?.get('/group')).toEqual({ line: 3, column: 1 });
  });

  test('a dictionary folder outside the model folder', async () => {
    const { model, issues } = await loadModel(
      exampleFileSystem(sharedDictionary()),
      '',
    );
    expect(issues).toEqual([]);
    expect(model.dictionaries.map((item) => item.file)).toEqual([
      '../shared/standard.yaml',
    ]);
    expect(model.dictionaries[0]?.data.words).toHaveLength(5);
  });

  test('a dictionary folder that does not exist is an empty dictionary', async () => {
    const files = replaceOnce(
      exampleFiles(),
      'model.yaml',
      'targets:\n',
      'dictionaries:\n  - missing\ntargets:\n',
    );
    const { model, issues } = await loadModel(exampleFileSystem(files), '');
    expect(issues).toEqual([]);
    expect(model.manifest?.data.dictionaries).toEqual(['missing']);
    expect(model.dictionaries).toEqual([]);
    expect(model.entities).toHaveLength(10);
  });

  test.each<[string, string[], string[]]>([
    [
      'the same folder twice',
      ['dictionary', './dictionary'],
      ['dictionary/standard.yaml', 'dictionary/sub/extra.yaml'],
    ],
    [
      'a folder and its subfolder',
      ['dictionary', 'dictionary/sub'],
      ['dictionary/standard.yaml', 'dictionary/sub/extra.yaml'],
    ],
    [
      'a subfolder and then its folder',
      ['dictionary/sub', 'dictionary/', 'x/../dictionary/sub'],
      ['dictionary/sub/extra.yaml', 'dictionary/standard.yaml'],
    ],
  ])(
    'dictionary folders that overlap (%s): each file read once, where first found',
    async (_name, folders, expected) => {
      const files = {
        ...replaceOnce(
          exampleFiles(),
          'model.yaml',
          'targets:\n',
          `dictionaries:\n${folders.map((f) => `  - ${f}\n`).join('')}targets:\n`,
        ),
        'dictionary/sub/extra.yaml': '# 추가\nwords: []\n',
        'dictionary/sub/broken.yaml': 'bogus: 1\n',
      };
      const { model, issues } = await loadModel(exampleFileSystem(files), '');
      expect(model.dictionaries.map((item) => item.file)).toEqual(expected);
      expect(issues).toEqual([
        {
          rule: 'schema',
          severity: 'error',
          file: 'dictionary/sub/broken.yaml',
          path: '/bogus',
          line: 1,
          column: 1,
          message: '/ must NOT have additional properties',
        },
        {
          rule: 'comment',
          severity: 'warning',
          file: 'dictionary/sub/extra.yaml',
          path: '',
          line: 1,
          column: 1,
          message: COMMENT_MESSAGE,
        },
      ]);
    },
  );

  test('an absolute dictionary folder is an error on its entry and is not read', async () => {
    const files = replaceOnce(
      exampleFiles(),
      'model.yaml',
      'targets:\n',
      'dictionaries:\n  - /abs/dict\n  - dictionary\n  - C:\\dict\ntargets:\n',
    );
    const memory = exampleFileSystem(files);
    const listed: string[] = [];
    const fs = {
      ...memory,
      list: (dir: string) => {
        listed.push(dir);
        return memory.list(dir);
      },
    };
    const { model, issues } = await loadModel(fs, '');
    const entry = (i: number, line: number): Issue => ({
      rule: 'schema',
      severity: 'error',
      file: 'model.yaml',
      path: `/dictionaries/${i}`,
      line,
      column: 5,
      message: ABSOLUTE_MESSAGE,
    });
    expect(issues).toEqual([entry(0, 6), entry(2, 8)]);
    expect(model.manifest?.data.dictionaries).toEqual([
      '/abs/dict',
      'dictionary',
      'C:\\dict',
    ]);
    expect(model.dictionaries.map((item) => item.file)).toEqual([
      'dictionary/standard.yaml',
    ]);
    expect(listed.filter((dir) => dir.includes('dict'))).toEqual([
      'dictionary',
    ]);
  });

  test('a broken model.yaml: no manifest, the default dictionary folder, the rest still read', async () => {
    const { model, issues } = await loadModel(
      exampleFileSystem(
        sharedDictionary('bogus: 1\ndictionaries:\n  - ../shared\n'),
      ),
      '',
    );
    expect(issues).toEqual([
      {
        rule: 'schema',
        severity: 'error',
        file: 'model.yaml',
        path: '/bogus',
        line: 5,
        column: 1,
        message: '/ must NOT have additional properties',
      },
    ]);
    expect(model.manifest).toBeUndefined();
    expect('manifest' in model).toBe(false);
    // `dictionary/` is gone, so the default folder is read and found empty.
    expect(model.dictionaries).toEqual([]);
    const withDefault = await loadModel(
      exampleFileSystem({
        ...sharedDictionary('bogus: 1\ndictionaries:\n  - ../shared\n'),
        'dictionary/standard.yaml':
          exampleFiles()['dictionary/standard.yaml'] ?? '',
      }),
      '',
    );
    expect(withDefault.model.dictionaries.map((item) => item.file)).toEqual([
      'dictionary/standard.yaml',
    ]);
    expect(model.entities).toHaveLength(10);
    expect(model.layouts).toHaveLength(2);
  });

  test('a CRLF file reads as its LF form, positions included', async () => {
    const file = 'entities/customer.yaml';
    const lf = exampleFiles();
    const crlf = { ...lf, [file]: (lf[file] ?? '').replace(/\n/g, '\r\n') };
    expect(crlf[file]).toContain('\r\n');
    const [a, b] = await Promise.all([
      loadModel(exampleFileSystem(lf), ''),
      loadModel(exampleFileSystem(crlf), ''),
    ]);
    expect(b.issues).toEqual([]);
    expect(b.model).toEqual(a.model);
    expect([...(b.positions.get(file) ?? [])]).toEqual([
      ...(a.positions.get(file) ?? []),
    ]);
    expect(b.positions.get(file)?.size).toBeGreaterThan(10);
  });

  test("the adapter's failures reject: a missing model.yaml, an unreadable file", async () => {
    const files = exampleFiles();
    delete files['model.yaml'];
    await expect(
      loadModel(exampleFileSystem(files), ''),
    ).rejects.toBeInstanceOf(FileNotFoundError);
    const memory = exampleFileSystem();
    const denied = new Error('EACCES');
    const fs = {
      ...memory,
      readText: async (path: string) => {
        if (path === 'entities/order.yaml') throw denied;
        return memory.readText(path);
      },
    };
    await expect(loadModel(fs, '')).rejects.toBe(denied);
  });
});
