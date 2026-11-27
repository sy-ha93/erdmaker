import { describe, expect, test } from 'vitest';
import { parseJson } from './json.js';

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
});
