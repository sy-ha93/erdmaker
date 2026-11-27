import { describe, expect, test } from 'vitest';
import { parseJson } from './json.js';
import { MAX_NESTING, parseYaml } from './yaml.js';

const FILE = 'layouts/sales.json';

function only(text: string) {
  const result = parseJson(FILE, text);
  expect(result.value).toBeUndefined();
  expect(result.positions.size).toBe(0);
  expect(result.issues).toHaveLength(1);
  return result.issues[0];
}

const layout = [
  '{',
  '  "formatVersion": "0.1",',
  '  "subjectArea": "sales",',
  '  "nodes": {',
  '    "order": { "x": 380, "y": 40, "width": 240 }',
  '  },',
  '  "edges": {',
  '    "e1": {',
  '      "waypoints": [{ "x": 1, "y": 2 }]',
  '    }',
  '  }',
  '}',
  '',
].join('\n');

describe('layout JSON reading', () => {
  test('a valid file gives the JSON.parse value and no issues', () => {
    const result = parseJson(FILE, layout);
    expect(result.issues).toEqual([]);
    expect(result.value).toEqual(JSON.parse(layout));
    expect(result.firstComment).toBeUndefined();
  });

  test('the position index of a valid file', () => {
    expect(Object.fromEntries(parseJson(FILE, layout).positions)).toEqual({
      '/formatVersion': { line: 2, column: 3 },
      '/subjectArea': { line: 3, column: 3 },
      '/nodes': { line: 4, column: 3 },
      '/nodes/order': { line: 5, column: 5 },
      '/nodes/order/x': { line: 5, column: 16 },
      '/nodes/order/y': { line: 5, column: 26 },
      '/nodes/order/width': { line: 5, column: 35 },
      '/edges': { line: 7, column: 3 },
      '/edges/e1': { line: 8, column: 5 },
      '/edges/e1/waypoints': { line: 9, column: 7 },
      '/edges/e1/waypoints/0': { line: 9, column: 21 },
      '/edges/e1/waypoints/0/x': { line: 9, column: 23 },
      '/edges/e1/waypoints/0/y': { line: 9, column: 31 },
    });
  });

  test('CRLF and tab indentation are valid', () => {
    const text = '{\r\n\t"formatVersion": "0.1",\r\n\t"nodes": {}\r\n}\r\n';
    const result = parseJson(FILE, text);
    expect(result.issues).toEqual([]);
    expect(result.value).toEqual({ formatVersion: '0.1', nodes: {} });
    expect(result.positions.get('/nodes')).toEqual({ line: 3, column: 2 });
  });

  test('a __proto__ key stays an own key', () => {
    const result = parseJson(FILE, '{"ext": {"__proto__": {"x": 1}}}');
    const ext = (result.value as { ext: object }).ext;
    expect(Object.keys(ext)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(ext)).toBe(Object.prototype);
  });
});

describe('layout JSON syntax', () => {
  test('the engine message has a position: that position (AC-07 input, 2:1)', () => {
    expect(only('{"formatVersion": "0.1", "nodes": {\n')).toEqual({
      rule: 'syntax',
      severity: 'error',
      file: FILE,
      path: '',
      line: 2,
      column: 1,
      message:
        "Expected property name or '}' in JSON at position 36 (line 2 column 1)",
    });
    expect(only('{\n  "a": 1,\n}\n')).toMatchObject({ line: 3, column: 1 });
  });

  test('no engine position: the first error of the YAML parser', () => {
    expect(only('{\n  "a": @x\n}\n')).toEqual({
      rule: 'syntax',
      severity: 'error',
      file: FILE,
      path: '',
      line: 2,
      column: 8,
      message:
        'Unexpected token \'@\', "{\\n  "a": @x\\n}\\n" is not valid JSON',
    });
  });

  test.each([
    ['a missing value', '{\n  "a": \n}\n'],
    ['an empty file', ''],
    ['a byte order mark', '﻿{"a": 1}'],
  ])('no engine position and no YAML error: 1:1 (%s)', (_name, text) => {
    expect(only(text)).toMatchObject({
      rule: 'syntax',
      path: '',
      line: 1,
      column: 1,
    });
  });

  test('the message is one line', () => {
    const { message } = only('{\n  "a": \n}\n');
    expect(message).not.toMatch(/[\r\n]/);
    expect(message).toBe(
      'Unexpected token \'}\', "{\\n  "a": \\n}\\n" is not valid JSON',
    );
  });

  test('a duplicate key is a syntax error at the second key (AC-07 input)', () => {
    expect(
      only('{"formatVersion": "0.1", "nodes": {}, "nodes": {}}\n'),
    ).toEqual({
      rule: 'syntax',
      severity: 'error',
      file: FILE,
      path: '',
      line: 1,
      column: 39,
      message: 'Map keys must be unique at line 1, column 39:',
    });
  });

  test('keys that are equal after unescaping are duplicates', () => {
    expect(only('{"\\u002f": 1, "/": 2}')).toMatchObject({
      rule: 'syntax',
      line: 1,
      column: 15,
    });
  });

  test('source text the engine quotes is not taken for its position (FR-09)', () => {
    expect(only('[(line 9 column 9)]')).toEqual({
      rule: 'syntax',
      severity: 'error',
      file: FILE,
      path: '',
      line: 1,
      column: 1,
      message:
        'Unexpected token \'(\', "[(line 9 column 9)]" is not valid JSON',
    });
  });
});

describe('layout JSON duplicate keys', () => {
  /** Line, column and message of each issue. */
  const found = (text: string) =>
    parseJson(FILE, text).issues.map(({ line, column, message }) => ({
      line,
      column,
      message,
    }));
  const duplicateAt = (line: number, column: number) => ({
    line,
    column,
    message: `Map keys must be unique at line ${line}, column ${column}:`,
  });

  test('escaped keys, at the later key', () => {
    expect(found('{"a": 1, "\\u0061": 2}')).toEqual([duplicateAt(1, 10)]);
    expect(found('{\n  "a\\"": 1,\n  "a\\u0022": 2\n}')).toEqual([
      duplicateAt(3, 3),
    ]);
  });

  test('keys of different objects are not duplicates', () => {
    expect(found('[{"x": 1, "x": 2}, {"x": 3}]')).toEqual([duplicateAt(1, 11)]);
  });

  test("in the order of the YAML reader: after the duplicates in the key's value", () => {
    const text = '{"a": 1, "a": {"b": 1, "\\u0062": 2}}';
    expect(found(text)).toEqual([duplicateAt(1, 24), duplicateAt(1, 10)]);
    expect(found(text)).toEqual(
      parseYaml(FILE, text).issues.map(({ line, column, message }) => ({
        line,
        column,
        message,
      })),
    );
  });

  test('keys longer than 1024 characters: duplicates found, positions given', () => {
    const key = `"${'k'.repeat(1100)}"`;
    const twice = `{${key}: 1, ${key}: 2}`;
    expect(found(twice)).toEqual([duplicateAt(1, twice.lastIndexOf(key) + 1)]);
    const result = parseJson(FILE, `{${key}: [1]}`);
    expect(result.issues).toEqual([]);
    expect(Object.fromEntries(result.positions)).toEqual({
      [`/${'k'.repeat(1100)}`]: { line: 1, column: 2 },
      [`/${'k'.repeat(1100)}/0`]: { line: 1, column: key.length + 5 },
    });
  });

  test('no engine position: the YAML error at a duplicate key comes first', () => {
    expect(only('{"a":1,"a":')).toMatchObject({
      rule: 'syntax',
      line: 1,
      column: 8,
      message: 'Unexpected end of JSON input',
    });
  });
});

describe('layout JSON with many keys', () => {
  test('an object of 50000 distinct keys is read in well under two seconds', () => {
    const count = 50_000;
    const text = JSON.stringify(
      Object.fromEntries(Array.from({ length: count }, (_, i) => [`k${i}`, i])),
    );
    const start = performance.now();
    const result = parseJson(FILE, text);
    const elapsed = performance.now() - start;
    expect(result.issues).toEqual([]);
    expect(result.positions.size).toBe(count);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('deeply nested layout JSON', () => {
  const DEPTH = 5000;
  const arrays = '['.repeat(DEPTH) + ']'.repeat(DEPTH);
  const objects = '{"a":'.repeat(DEPTH) + '1' + '}'.repeat(DEPTH);

  /** How many containers deep the first-item chain goes, without recursion. */
  function depthOf(value: unknown): number {
    let depth = 0;
    for (let node = value; typeof node === 'object' && node !== null;) {
      depth += 1;
      node = Array.isArray(node) ? node[0] : (node as { a: unknown }).a;
    }
    return depth;
  }

  test.each([
    ['arrays', arrays, MAX_NESTING + 1],
    ['objects', objects, '{"a":'.length * MAX_NESTING + 1],
  ])(
    '5000 levels of valid %s: the YAML nesting error, no value',
    (_name, text, column) => {
      const result = parseJson(FILE, text);
      expect(result.value).toBeUndefined();
      expect(result.positions.size).toBe(0);
      expect(result.issues).toEqual([
        {
          rule: 'syntax',
          severity: 'error',
          file: FILE,
          path: '',
          line: 1,
          column,
          message: `Collections are nested more than ${MAX_NESTING} levels deep at line 1, column ${column}:`,
        },
      ]);
      // One limit for every model file: the same issue as for YAML.
      expect(result.issues).toEqual(parseYaml(FILE, text).issues);
    },
  );

  test('nesting up to the limit is read, with positions', () => {
    const atLimit = '['.repeat(MAX_NESTING) + ']'.repeat(MAX_NESTING);
    const result = parseJson(FILE, atLimit);
    expect(result.issues).toEqual([]);
    expect(depthOf(result.value)).toBe(MAX_NESTING);
    expect(result.positions.size).toBe(MAX_NESTING - 1);
  });

  test('5000 levels with a syntax error: one syntax issue', () => {
    // No engine position: the YAML reader's first error, its nesting limit.
    expect(only('['.repeat(DEPTH) + '@' + ']'.repeat(DEPTH))).toMatchObject({
      rule: 'syntax',
      line: 1,
      column: MAX_NESTING + 1,
      message: expect.stringMatching(/^Unexpected token '@'/),
    });
  });

  // The text below nests 3 levels more than `depth`.
  test.each([3, MAX_NESTING - 3])(
    'duplicate keys %i levels down are found, worded the same at every depth',
    (depth) => {
      const text =
        '{"x":\n'.repeat(depth) +
        '{"b": 1, "\\u0062": 2, "c": [{"d": "\\"}", "d": 0}]}' +
        '}'.repeat(depth);
      const result = parseJson(FILE, text);
      expect(result.value).toBeUndefined();
      const line = depth + 1;
      expect(
        result.issues.map(({ rule, line, column, message }) => ({
          rule,
          line,
          column,
          message,
        })),
      ).toEqual([
        {
          rule: 'syntax',
          line,
          column: 10,
          message: `Map keys must be unique at line ${line}, column 10:`,
        },
        {
          rule: 'syntax',
          line,
          column: 42,
          message: `Map keys must be unique at line ${line}, column 42:`,
        },
      ]);
    },
  );

  test.each([300, DEPTH])(
    'duplicate keys %i levels down: past the limit, only the nesting error',
    (depth) => {
      const text =
        '{"x":\n'.repeat(depth) + '{"b": 1, "b": 2}' + '}'.repeat(depth);
      expect(only(text)).toMatchObject({
        rule: 'syntax',
        line: MAX_NESTING + 1,
        column: 1,
        message: `Collections are nested more than ${MAX_NESTING} levels deep at line ${MAX_NESTING + 1}, column 1:`,
      });
    },
  );
});
