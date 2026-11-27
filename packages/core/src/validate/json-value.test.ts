import { describe, expect, test } from 'vitest';
import { jsonValueIssues } from './json-value.js';

const paths = (value: unknown) =>
  jsonValueIssues('f.yaml', value).map((issue) => issue.path);

describe('JSON value check', () => {
  test.each([
    ['null', null],
    ['true', true],
    ['false', false],
    ['empty string', ''],
    ['string', 'NO'],
    ['zero', 0],
    ['negative zero', -0],
    ['fraction', 0.1],
    ['negative integer', -3],
    ['largest safe integer', Number.MAX_SAFE_INTEGER],
    ['smallest safe integer', Number.MIN_SAFE_INTEGER],
    ['large non-integer', 1.5e15 + 0.5],
    ['empty array', []],
    ['empty object', {}],
    ['nested', { a: [1, { b: 'x', c: null }], d: { e: [] } }],
    ['null-prototype object', Object.assign(Object.create(null), { a: 1 })],
    [
      'own __proto__ key from JSON.parse',
      JSON.parse('{"__proto__": {"x": 1}}'),
    ],
  ])('accepts %s', (_name, value) => {
    expect(jsonValueIssues('f.yaml', value)).toEqual([]);
  });

  test('accepts the same object referenced from two places', () => {
    const shared = { x: 1, y: [2] };
    expect(
      paths({ ext: { a: shared, b: shared, list: [shared, shared] } }),
    ).toEqual([]);
  });

  test.each([
    ['undefined', undefined],
    ['function', () => 1],
    ['symbol', Symbol('s')],
    ['bigint', 1n],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['2 ** 53', 2 ** 53],
    ['-(2 ** 53)', -(2 ** 53)],
    ['9007199254740993 as read', Number('9007199254740993')],
    ['1e300', 1e300],
    ['Date', new Date(0)],
    ['Uint8Array', new Uint8Array([1])],
    ['Map', new Map()],
    ['Set', new Set()],
    ['class instance', new (class Point {})()],
    ['RegExp', /x/],
    ['boxed string', Object('x')],
    ['Array subclass instance', new (class List extends Array {})()],
  ])('rejects %s', (_name, value) => {
    expect(paths({ ext: { v: value } })).toEqual(['/ext/v']);
  });

  test('reports the whole file as "" and its message as "/"', () => {
    expect(jsonValueIssues('entities/a.yaml', undefined)).toEqual([
      {
        rule: 'schema',
        severity: 'error',
        file: 'entities/a.yaml',
        path: '',
        message: '/ must be a JSON value',
      },
    ]);
  });

  test('builds the issue with the path in the message', () => {
    expect(jsonValueIssues('m/e.yaml', { ext: { big: Infinity } })).toEqual([
      {
        rule: 'schema',
        severity: 'error',
        file: 'm/e.yaml',
        path: '/ext/big',
        message: '/ext/big must be a JSON value',
      },
    ]);
  });

  test('reports every bad value, in key and item order, without descending into them', () => {
    const value = {
      a: [1, NaN, { b: undefined }],
      c: new Date(0),
      d: { e: Infinity, f: 'ok' },
    };
    expect(paths(value)).toEqual(['/a/1', '/a/2/b', '/c', '/d/e']);
  });

  test('escapes ~ and / in keys', () => {
    expect(paths({ 'a/b': { 'c~d': NaN } })).toEqual(['/a~1b/c~0d']);
  });

  test('reports a hole in a sparse array', () => {
    const list = [1];
    list[2] = 3;
    expect(paths({ list })).toEqual(['/list/1']);
  });

  test('reports an accessor property without calling it', () => {
    let called = false;
    const value = {
      get x() {
        called = true;
        return 1;
      },
    };
    expect(paths(value)).toEqual(['/x']);
    expect(called).toBe(false);
  });

  test('reports a cycle where it closes', () => {
    const entity: Record<string, unknown> = { id: 'a' };
    entity.ext = entity;
    expect(paths(entity)).toEqual(['/ext']);

    const root: Record<string, unknown> = {};
    const inner: Record<string, unknown> = { list: [] };
    root.a = { b: inner };
    (inner.list as unknown[]).push(root.a);
    expect(paths(root)).toEqual(['/a/b/list/0']);
  });

  test('reports an array that contains itself', () => {
    const list: unknown[] = [1];
    list.push(list);
    expect(paths({ list })).toEqual(['/list/1']);
  });

  test('does not throw on a proxy whose traps throw', () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('trap');
        },
        ownKeys() {
          throw new Error('trap');
        },
      },
    );
    expect(paths({ ext: hostile })).toEqual(['/ext']);
  });

  test.each([
    ['arrays', (inner: unknown) => [inner]],
    ['objects', (inner: unknown) => ({ a: inner })],
  ])('does not throw on 10000 levels of nested %s', (_name, wrap) => {
    let value: unknown = 'leaf';
    for (let i = 0; i < 10000; i += 1) value = wrap(value);
    expect(jsonValueIssues('f.yaml', value)).toEqual([]);

    let bad: unknown = NaN;
    for (let i = 0; i < 10000; i += 1) bad = wrap(bad);
    const issues = jsonValueIssues('f.yaml', bad);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path.split('/')).toHaveLength(10001);
  });

  test('reports a cycle that closes 10000 levels down, once', () => {
    const root: Record<string, unknown> = {};
    let node = root;
    for (let i = 0; i < 10000; i += 1) {
      const child: Record<string, unknown> = {};
      node.a = child;
      node = child;
    }
    node.back = root;
    const issues = jsonValueIssues('f.yaml', root);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe(`${'/a'.repeat(10000)}/back`);
  });

  test('reports the holes of a sparse array as one issue, in index order', () => {
    const list: unknown[] = [NaN];
    list[2] = 1;
    list[4] = Infinity;
    list.length = 6;
    expect(paths({ list })).toEqual(['/list/0', '/list/1', '/list/4']);

    const trailing: unknown[] = [1, 2];
    trailing.length = 4;
    expect(paths({ trailing })).toEqual(['/trailing/2']);
  });

  test('a sparse array of length 1e7 is checked without visiting every index', () => {
    const list: unknown[] = [];
    list.length = 1e7;
    list[5] = NaN;
    list[9_999_999] = 'ok';
    const started = performance.now();
    expect(paths({ list })).toEqual(['/list/0', '/list/5']);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test('a non-enumerable item is still checked, extra array keys are not', () => {
    const list: unknown[] = [1];
    Object.defineProperty(list, 0, { value: NaN, enumerable: false });
    Object.assign(list, { extra: NaN });
    expect(paths({ list })).toEqual(['/list/0']);
  });
});
