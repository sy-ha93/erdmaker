import { describe, expect, test } from 'vitest';
import { bestTime } from '../testing/timing.js';
import { checkJsonValue, jsonValueIssues } from './json-value.js';

const paths = (value: unknown) =>
  jsonValueIssues('f.yaml', value).map((issue) => issue.path);

describe('JSON value check', () => {
  test('a sparse array of length 1e7 is checked without visiting every index', async () => {
    const list: unknown[] = [];
    list.length = 1e7;
    list[5] = NaN;
    list[9_999_999] = 'ok';
    expect(paths({ list })).toEqual(['/list/0', '/list/5']);
    // Visiting every index takes seconds; the best of three runs stays well below one.
    expect(await bestTime(3, () => paths({ list }))).toBeLessThan(1000);
  });
});

describe('JSON value check: shared objects', () => {
  test('40 levels each holding the level before twice are checked at once', async () => {
    let value: unknown = { x: 1 };
    for (let level = 0; level < 40; level += 1) value = { a: value, b: value };
    // Visiting each place takes 2 ** 40 steps; checked object by object, it takes milliseconds.
    expect(
      await bestTime(3, () => checkJsonValue('f.yaml', value)),
    ).toBeLessThan(200);
    expect(checkJsonValue('f.yaml', value).tooLarge?.path).toBe('');
  });

  test('40 such levels around a value that is not JSON: walked up to the limit, then stopped', async () => {
    let value: unknown = { x: undefined };
    for (let level = 0; level < 40; level += 1) value = { a: value, b: value };
    // Each copy is counted once, so the walk stops after about the limit's values.
    expect(
      await bestTime(3, () => checkJsonValue('f.yaml', value)),
    ).toBeLessThan(1000);
    expect(checkJsonValue('f.yaml', value).tooLarge?.path).toBe('');
  });
});
