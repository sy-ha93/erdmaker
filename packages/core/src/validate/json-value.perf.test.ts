import { describe, expect, test } from 'vitest';
import { bestTime } from '../testing/timing.js';
import { jsonValueIssues } from './json-value.js';

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
