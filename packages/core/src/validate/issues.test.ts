import { describe, expect, test } from 'vitest';
import type { Issue } from '../model/types.js';
import { compareIssues, finishIssues, placeIssue } from './issues.js';

const at = (path: string, extra: Partial<Issue> = {}): Issue => ({
  rule: 'schema',
  severity: 'error',
  file: 'entities/a.yaml',
  path,
  message: `${path || '/'} m`,
  ...extra,
});

const positions = new Map([
  [
    'entities/a.yaml',
    new Map([
      ['/name', { line: 2, column: 1 }],
      ['/attributes/0', { line: 4, column: 5 }],
    ]),
  ],
]);

describe('issue positions', () => {
  test('a path in the index takes its position', () => {
    expect(placeIssue(at('/attributes/0'), positions)).toEqual(
      at('/attributes/0', { line: 4, column: 5 }),
    );
  });

  test('a position the parser gave is kept', () => {
    const parser = at('/name', { rule: 'syntax', line: 9, column: 3 });
    expect(placeIssue(parser, positions)).toEqual(parser);
  });

  test('the whole file of an indexed file is 1:1', () => {
    expect(placeIssue(at(''), positions)).toEqual(
      at('', { line: 1, column: 1 }),
    );
    expect(
      placeIssue(at(''), new Map([['entities/a.yaml', new Map()]])),
    ).toEqual(at('', { line: 1, column: 1 }));
  });

  test('a path missing from the index has no position', () => {
    expect(placeIssue(at('/keys'), positions)).toEqual(at('/keys'));
  });

  test('a file without an index has no positions, the whole file included', () => {
    expect(placeIssue(at('/name', { file: 'b.yaml' }), positions)).toEqual(
      at('/name', { file: 'b.yaml' }),
    );
    expect(placeIssue(at(''))).toEqual(at(''));
    expect(placeIssue(at('', { line: 3 }))).toEqual(at(''));
  });
});

describe('issue order', () => {
  test('file, no position first, line, column, rule, message, by code unit', () => {
    const issues: Issue[] = [
      at('/z', { file: 'a.yaml', line: 2, column: 1, rule: 'R02' }),
      at('/y', {
        file: 'a.yaml',
        line: 2,
        column: 1,
        rule: 'R01',
        message: 'b',
      }),
      at('/x', {
        file: 'a.yaml',
        line: 2,
        column: 1,
        rule: 'R01',
        message: 'B',
      }),
      at('/w', { file: 'a.yaml', line: 1, column: 7 }),
      at('/v', { file: 'a.yaml', line: 1, column: 10 }),
      at('/u', { file: 'a.yaml', line: 10, column: 1 }),
      at('/t', { file: 'a.yaml' }),
      at('/s', { file: 'B.yaml', line: 1, column: 1 }),
      at('/r', { file: 'a.yaml', line: 2, column: 1, rule: 'P01' }),
    ];
    expect([...issues].sort(compareIssues).map((issue) => issue.path)).toEqual([
      '/s',
      '/t',
      '/w',
      '/v',
      '/r',
      '/x',
      '/y',
      '/z',
      '/u',
    ]);
  });

  test('finishIssues places, then sorts, and leaves its input alone', () => {
    const input = [at('/name'), at('/keys'), at('/attributes/0')];
    const copy = structuredClone(input);
    expect(finishIssues(input, positions)).toEqual([
      at('/keys'),
      at('/name', { line: 2, column: 1 }),
      at('/attributes/0', { line: 4, column: 5 }),
    ]);
    expect(input).toEqual(copy);
  });
});
