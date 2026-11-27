import { describe, expect, test } from 'vitest';
import { MAX_NESTING, parseYaml } from './yaml.js';

const FILE = 'entities/order.yaml';

/** The issues without `file` and `severity`, which every case checks once below. */
function issuesOf(text: string) {
  const { issues } = parseYaml(FILE, text);
  for (const issue of issues) {
    expect(issue.file).toBe(FILE);
    expect(issue.severity).toBe('error');
    expect(issue.path).toBe('');
  }
  return issues.map(({ rule, line, column, message }) => ({
    rule,
    line,
    column,
    message,
  }));
}

describe('YAML reading', () => {
  test('a valid file gives its value and no issues', () => {
    const result = parseYaml(
      FILE,
      'id: order\nname: Order\nlist:\n  - 1\n  - a\n',
    );
    expect(result.issues).toEqual([]);
    expect(result.value).toEqual({
      id: 'order',
      name: 'Order',
      list: [1, 'a'],
    });
  });

  test('reads with the YAML 1.2 core schema: NO, yes, on, off stay strings', () => {
    const { value } = parseYaml(
      FILE,
      'a: NO\nb: yes\nc: on\nd: off\ne: ~\nf: 0o17\ng: true\n',
    );
    expect(value).toEqual({
      a: 'NO',
      b: 'yes',
      c: 'on',
      d: 'off',
      e: null,
      f: 15,
      g: true,
    });
  });

  test('a %YAML 1.1 directive does not change the schema', () => {
    const { value, issues } = parseYaml(
      FILE,
      '%YAML 1.1\n---\na: NO\nb: yes\n',
    );
    expect(issues).toEqual([]);
    expect(value).toEqual({ a: 'NO', b: 'yes' });
  });

  test('CRLF files read the same as LF files', () => {
    const lf = parseYaml(FILE, 'id: a\nnote: |\n  x\n  y\nn: 1\n');
    const crlf = parseYaml(FILE, 'id: a\r\nnote: |\r\n  x\r\n  y\r\nn: 1\r\n');
    expect(crlf.issues).toEqual([]);
    expect(crlf.value).toEqual(lf.value);
    expect([...crlf.positions]).toEqual([...lf.positions]);
  });

  test('an empty file is null, not an error', () => {
    expect(parseYaml(FILE, '')).toMatchObject({ value: null, issues: [] });
  });
});

describe('YAML syntax', () => {
  test('duplicate key: the first line of the parser message, at the later key', () => {
    expect(issuesOf('id: a\nname: x\nid: b\n')).toEqual([
      {
        rule: 'syntax',
        line: 3,
        column: 1,
        message: 'Map keys must be unique at line 3, column 1:',
      },
    ]);
  });

  test('a broken flow sequence', () => {
    expect(issuesOf('a: [1, 2\nb: 3\n')).toEqual([
      {
        rule: 'syntax',
        line: 2,
        column: 1,
        message:
          'Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 1:',
      },
    ]);
  });

  test('two documents in one file', () => {
    expect(issuesOf('a: 1\n---\nb: 2\n')).toEqual([
      {
        rule: 'syntax',
        line: 2,
        column: 1,
        message:
          'Source contains multiple documents; please use YAML.parseAllDocuments() at line 2, column 1:',
      },
    ]);
  });

  test('keys that become the same string collide, at the later key', () => {
    expect(issuesOf('id: a\next:\n  true: a\n  "true": b\n')).toEqual([
      {
        rule: 'syntax',
        line: 4,
        column: 3,
        message: 'Map keys collide as "true"',
      },
    ]);
    expect(issuesOf('ext:\n  1: a\n  x: 0\n  "1": b\n')).toEqual([
      {
        rule: 'syntax',
        line: 4,
        column: 3,
        message: 'Map keys collide as "1"',
      },
    ]);
    expect(issuesOf('ext:\n  ~: a\n  "": b\n')).toEqual([
      {
        rule: 'syntax',
        line: 3,
        column: 3,
        message: 'Map keys collide as ""',
      },
    ]);
  });

  test('a collection as a map key', () => {
    expect(issuesOf('id: a\n? [a, b]\n: 1\n')).toEqual([
      {
        rule: 'syntax',
        line: 2,
        column: 3,
        message: 'Map keys must be scalars',
      },
    ]);
    expect(issuesOf('ext:\n  ? {k: v}\n  : 1\n')).toEqual([
      {
        rule: 'syntax',
        line: 2,
        column: 5,
        message: 'Map keys must be scalars',
      },
    ]);
  });

  test('a file with a syntax error reports no yaml-feature issues and has no value', () => {
    const result = parseYaml(FILE, 'a: &x [1\nb: *x\n');
    expect(result.issues.map((issue) => issue.rule)).toEqual(['syntax']);
    expect(result.value).toBeUndefined();
    expect(result.positions.size).toBe(0);
  });
});

describe('YAML duplicate keys', () => {
  /** The parser's duplicate key issue at the later key. */
  const duplicateAt = (line: number, column: number) => ({
    rule: 'syntax',
    line,
    column,
    message: `Map keys must be unique at line ${line}, column ${column}:`,
  });

  test('plain and quoted keys with the same value are duplicates', () => {
    expect(issuesOf('a: 1\n"a": 2\n')).toEqual([duplicateAt(2, 1)]);
    expect(issuesOf("a: 1\n'a': 2\nb: 1\n1.0: 2\n0x1: 3\n")).toEqual([
      duplicateAt(2, 1),
      duplicateAt(5, 1),
    ]);
    expect(issuesOf('~: a\nnull: b\n')).toEqual([duplicateAt(2, 1)]);
  });

  test('keys with different values that become the same string only collide', () => {
    expect(issuesOf('.nan: a\n.nan: b\n')).toEqual([
      {
        rule: 'syntax',
        line: 2,
        column: 1,
        message: 'Map keys collide as "NaN"',
      },
    ]);
  });

  test('nested maps, flow maps and empty keys', () => {
    expect(issuesOf('x:\n  y:\n    a: 1\n    a: 2\n')).toEqual([
      duplicateAt(4, 5),
    ]);
    expect(issuesOf('- {a: 1,\n   "a": 2}\n')).toEqual([duplicateAt(2, 4)]);
    expect(issuesOf('? \n: 1\n?\n: 2\n')).toEqual([duplicateAt(4, 1)]);
    expect(issuesOf('\uFEFF{a: 1, a: 2}')).toEqual([duplicateAt(1, 8)]);
  });

  test("in a flow map, after the duplicates in the key's value", () => {
    expect(issuesOf('{a: 1, a: {b: 1, b: 2}}')).toEqual([
      duplicateAt(1, 18),
      duplicateAt(1, 8),
    ]);
  });

  test('in the order the parser finds them among its other errors', () => {
    const broken = (line: number) => ({
      rule: 'syntax',
      line,
      column: 1,
      message: `Flow sequence in block collection must be sufficiently indented and end with a ] at line ${line}, column 1:`,
    });
    expect(issuesOf('a: 1\na: 2\nb: [1\n')).toEqual([
      duplicateAt(2, 1),
      broken(4),
    ]);
    expect(issuesOf('b: [1\na: 1\na: 2\n')).toEqual([
      broken(2),
      duplicateAt(3, 1),
    ]);
  });

  test('reported before anchors and tags, which are then not looked for', () => {
    expect(issuesOf('a: 1\n&x a: 2\nb: !t 1\n')).toEqual([duplicateAt(2, 4)]);
  });
});

describe('YAML features', () => {
  test('an anchor', () => {
    expect(issuesOf('id: a\next: &x {b: 1}\n')).toEqual([
      {
        rule: 'yaml-feature',
        line: 2,
        column: 6,
        message: 'YAML anchors are not allowed',
      },
    ]);
  });

  test('an anchor and its alias', () => {
    expect(issuesOf('a: &x 1\nb: *x\n')).toEqual([
      {
        rule: 'yaml-feature',
        line: 1,
        column: 4,
        message: 'YAML anchors are not allowed',
      },
      {
        rule: 'yaml-feature',
        line: 2,
        column: 4,
        message: 'YAML aliases are not allowed',
      },
    ]);
  });

  test('an alias that resolves to nothing does not throw', () => {
    const result = parseYaml(FILE, 'id: a\nname: *nope\n');
    expect(result.value).toBeUndefined();
    expect(issuesOf('id: a\nname: *nope\n')).toEqual([
      {
        rule: 'yaml-feature',
        line: 2,
        column: 7,
        message: 'YAML aliases are not allowed',
      },
    ]);
  });

  test.each([
    ['a custom tag', 'a: !custom 1\n', '!custom'],
    ['!!binary', 'a: !!binary aGk=\n', 'tag:yaml.org,2002:binary'],
    [
      '!!timestamp',
      'a: !!timestamp 2001-12-14\n',
      'tag:yaml.org,2002:timestamp',
    ],
    ['!!set', 'a: !!set {x: null}\n', 'tag:yaml.org,2002:set'],
    ['!!str', 'a: !!str 1\n', 'tag:yaml.org,2002:str'],
    ['a verbatim tag', 'a: !<tag:x> 1\n', 'tag:x'],
    ['the non-specific tag', 'a: ! 1\n', '!'],
  ])('%s', (_name, text, tag) => {
    expect(issuesOf(text)).toEqual([
      {
        rule: 'yaml-feature',
        line: 1,
        column: 4,
        message: `YAML tag ${tag} is not allowed`,
      },
    ]);
  });

  test('a tag declared with %TAG is reported by its full name', () => {
    expect(
      issuesOf('%TAG !e! tag:example.com,2000:app/\n---\nid: a\nb: !e!foo 1\n'),
    ).toEqual([
      {
        rule: 'yaml-feature',
        line: 4,
        column: 4,
        message: 'YAML tag tag:example.com,2000:app/foo is not allowed',
      },
    ]);
  });

  test('features inside sequences and nested maps, in file order', () => {
    expect(issuesOf('x:\n  - &a 1\n  - y:\n      z: !t 2\n')).toEqual([
      {
        rule: 'yaml-feature',
        line: 2,
        column: 5,
        message: 'YAML anchors are not allowed',
      },
      {
        rule: 'yaml-feature',
        line: 4,
        column: 10,
        message: 'YAML tag !t is not allowed',
      },
    ]);
  });

  test('a file with a feature has no value and no positions', () => {
    const result = parseYaml(FILE, 'id: a\nunknown: !custom 1\n');
    expect(result.value).toBeUndefined();
    expect(result.positions.size).toBe(0);
  });
});

describe('YAML first comment', () => {
  test.each([
    ['at the top', '# c\na: 1\n', 1, 1],
    ['at the end of a line', 'a: 1 # c\n', 1, 6],
    ['between keys', 'a: 1\n# c\nb: 2\n', 2, 1],
    ['at the end of the file', 'a: 1\n# c\n', 2, 1],
    ['inside a sequence', 'a:\n  - 1\n  # c\n  - 2\n', 3, 3],
    ['after a nested map', 'a:\n  b: 1\n  # c\nd: 2\n', 3, 3],
    ['on a block scalar header', 'a: |  # c\n  text # not a comment\n', 1, 7],
    ['inside a flow collection', 'a: [1, # c\n  2]\n', 1, 8],
    [
      'the earliest of several',
      'a: 1\nb: 2 # second\n# third\nc: 3 # x\n',
      2,
      6,
    ],
  ])('%s', (_name, text, line, column) => {
    const result = parseYaml(FILE, text);
    expect(result.issues).toEqual([]);
    expect(result.firstComment).toEqual({ line, column });
  });

  test('# inside quotes or a word is not a comment', () => {
    const result = parseYaml(FILE, 'a: "x # y"\nb: x#y\nc: |\n  # text\n');
    expect(result.issues).toEqual([]);
    expect(result.firstComment).toBeUndefined();
  });
});

describe('YAML position index', () => {
  const text = [
    'id: order',
    'name: Order',
    'attributes:',
    '  - id: a',
    '    tags: [x, y]',
    '  - id: b',
    'ext:',
    '  a/b: 1',
    '  c~d: 2',
    '  "": 3',
    '',
  ].join('\n');

  test('keys point at the key, items at the value, with escaped pointers', () => {
    const result = parseYaml(FILE, text);
    expect(result.issues).toEqual([]);
    expect(Object.fromEntries(result.positions)).toEqual({
      '/id': { line: 1, column: 1 },
      '/name': { line: 2, column: 1 },
      '/attributes': { line: 3, column: 1 },
      '/attributes/0': { line: 4, column: 5 },
      '/attributes/0/id': { line: 4, column: 5 },
      '/attributes/0/tags': { line: 5, column: 5 },
      '/attributes/0/tags/0': { line: 5, column: 12 },
      '/attributes/0/tags/1': { line: 5, column: 15 },
      '/attributes/1': { line: 6, column: 5 },
      '/attributes/1/id': { line: 6, column: 5 },
      '/ext': { line: 7, column: 1 },
      '/ext/a~1b': { line: 8, column: 3 },
      '/ext/c~0d': { line: 9, column: 3 },
      '/ext/': { line: 10, column: 3 },
    });
  });

  test('the whole file "" is not in the index', () => {
    expect(parseYaml(FILE, '# c\nid: a\n').positions.has('')).toBe(false);
  });

  test('a single pair in a flow sequence is a one-key map', () => {
    const result = parseYaml(FILE, 'list: [a: 1, b]\n');
    expect(result.value).toEqual({ list: [{ a: 1 }, 'b'] });
    expect(Object.fromEntries(result.positions)).toEqual({
      '/list': { line: 1, column: 1 },
      '/list/0': { line: 1, column: 8 },
      '/list/0/a': { line: 1, column: 8 },
      '/list/1': { line: 1, column: 14 },
    });
  });

  test('number and boolean keys use their string form', () => {
    const result = parseYaml(FILE, 'ext:\n  1e3: a\n  true: b\n  ~: c\n');
    expect([...result.positions.keys()]).toEqual([
      '/ext',
      '/ext/1000',
      '/ext/true',
      '/ext/',
    ]);
  });
});

describe('deeply nested YAML', () => {
  const nested = (depth: number) => '['.repeat(depth) + ']'.repeat(depth);

  test.each([
    ['flow sequences', nested(5000)],
    ['flow maps', '{a: '.repeat(5000) + '1' + '}'.repeat(5000)],
    [
      'block maps',
      Array.from({ length: 5000 }, (_, i) => `${' '.repeat(i)}a:`).join('\n'),
    ],
  ])('5000 levels of %s: syntax issues, no exception', (_name, text) => {
    // Twice: a second deep parse is what can bring the process down.
    for (let i = 0; i < 2; i += 1) {
      const result = parseYaml(FILE, text);
      expect(result.value).toBeUndefined();
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.every((issue) => issue.rule === 'syntax')).toBe(
        true,
      );
    }
  });

  const lines = (count: number, line: (i: number) => string) =>
    Array.from({ length: count }, (_, i) => line(i)).join('\n');
  type Shape = [string, (depth: number) => string, number, number];
  /**
   * Deep shapes that end by closing many collections at once, and where the
   * first collection past the limit starts. Written on one line, their text
   * grows with the depth.
   */
  const COMPACT: Shape[] = [
    [
      'a compact block sequence',
      (depth) => '- '.repeat(depth) + 'x\n- y\n',
      1,
      513,
    ],
    [
      'flow sequences in a block sequence',
      (depth) => '- ' + '['.repeat(depth) + ']'.repeat(depth) + '\n- y\n',
      1,
      258,
    ],
    [
      'flow maps in a block map',
      (depth) =>
        'a: ' + '{b: '.repeat(depth) + '1' + '}'.repeat(depth) + '\nc: 2\n',
      1,
      1024,
    ],
    ['an unclosed flow sequence', (depth) => '['.repeat(depth) + '\n', 1, 257],
  ];
  /** Indented a level per line, their text grows with the square of the depth. */
  const INDENTED: Shape[] = [
    [
      'an indented block sequence',
      (depth) => lines(depth, (i) => ' '.repeat(2 * i) + '-') + ' x\n- y\n',
      257,
      513,
    ],
    [
      'a block map',
      (depth) => lines(depth, (i) => ' '.repeat(i) + 'a:') + ' x\nb: y\n',
      257,
      257,
    ],
    [
      'block maps in block sequences',
      (depth) => lines(depth, (i) => ' '.repeat(2 * i) + '- a:') + ' x\n- y\n',
      129,
      257,
    ],
  ];

  describe.each<[number, Shape[]]>([
    [300, [...COMPACT, ...INDENTED]],
    [8_000, [...COMPACT, ...INDENTED]],
    [100_000, COMPACT],
  ])('%i levels', (depth, shapes) => {
    test.each(shapes)(
      '%s, then fewer: the nesting issue at the first collection past the limit',
      (_name, text, line, column) => {
        const source = text(depth);
        // Twice: a second deep parse is what can bring the process down.
        for (let i = 0; i < 2; i += 1) {
          expect(issuesOf(source)).toEqual([
            {
              rule: 'syntax',
              line,
              column,
              message: `Collections are nested more than ${MAX_NESTING} levels deep at line ${line}, column ${column}:`,
            },
          ]);
        }
      },
    );
  });

  test('nesting up to the limit is read, one level more is a syntax issue', () => {
    const atLimit = parseYaml(FILE, nested(MAX_NESTING));
    expect(atLimit.issues).toEqual([]);
    expect(JSON.stringify(atLimit.value)).toBe(nested(MAX_NESTING));

    const column = MAX_NESTING + 1;
    expect(issuesOf(nested(MAX_NESTING + 1))).toEqual([
      {
        rule: 'syntax',
        line: 1,
        column,
        message: `Collections are nested more than ${MAX_NESTING} levels deep at line 1, column ${column}:`,
      },
    ]);
  });
});

describe('YAML with a byte order mark', () => {
  const BOM = '\uFEFF';

  test('the mark is not a column of line 1', () => {
    expect(issuesOf(`${BOM}a: !t 1\n`)).toEqual(issuesOf('a: !t 1\n'));
    expect(issuesOf(`${BOM}a: [1\n`)).toEqual(issuesOf('a: [1\n'));
    expect(parseYaml(FILE, `${BOM}# c\na: 1\n`).firstComment).toEqual({
      line: 1,
      column: 1,
    });
    expect(
      Object.fromEntries(parseYaml(FILE, `${BOM}a: 1\nb:\n  c: 2\n`).positions),
    ).toEqual({
      '/a': { line: 1, column: 1 },
      '/b': { line: 2, column: 1 },
      '/b/c': { line: 3, column: 3 },
    });
  });
});
