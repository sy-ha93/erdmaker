import { fileURLToPath } from 'node:url';
import type { FileSystemAdapter } from '@erdmaker/core';
import { describe, expect, test } from 'vitest';
import { describeError, main, oneLine } from './main.js';

/** A real folder, so `main` gets past its folder check to the adapter. */
const DIR = fileURLToPath(new URL('.', import.meta.url));

/** An adapter whose every call rejects with `reason`. */
function failing(reason: unknown): FileSystemAdapter {
  const fail = () => Promise.reject(reason);
  return { readText: fail, writeText: fail, list: fail, remove: fail };
}

async function capture(reason: unknown) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(
    ['validate', DIR],
    { out: (line) => out.push(line), err: (line) => err.push(line) },
    () => failing(reason),
  );
  return { code, out, err };
}

describe('validate: main', () => {
  test.each([
    ['a string with a newline', 'no\nway', 'no\\nway'],
    ['an object', { code: 'X' }, '[object Object]'],
    ['undefined', undefined, 'undefined'],
    [
      'a value whose conversion throws',
      {
        toString() {
          throw new Error('no');
        },
      },
      'unknown error',
    ],
    ['an Error', new Error('gone\r\nnow'), 'gone\\r\\nnow'],
  ])(
    'an adapter that rejects with %s: 2 and one line',
    async (_name, reason, shown) => {
      expect(await capture(reason)).toEqual({
        code: 2,
        out: [],
        err: [`Cannot read ${DIR}: ${shown}`],
      });
    },
  );

  test('describeError takes the message of an Error and the string of anything else', () => {
    expect(describeError(new TypeError('t'))).toBe('t');
    expect(describeError(Symbol('s'))).toBe('Symbol(s)');
    expect(describeError(null)).toBe('null');
  });
});

describe('validate: oneLine', () => {
  test('an ordinary path, backslashes and non-ASCII included, is unchanged', () => {
    const path = 'entities/고객 a\\b.yaml';
    expect(oneLine(path)).toBe(path);
  });

  test('every line-breaking or control character is a visible escape', () => {
    expect(
      oneLine('a\nb\rc\td\u0000e\u001bf\u007fg\u0085h\u2028i\u2029j\u000bk'),
    ).toBe(
      'a\\nb\\rc\\td\\u{0}e\\u{1b}f\\u{7f}g\\u{85}h\\u{2028}i\\u{2029}j\\u{b}k',
    );
  });

  test('a long text of controls is escaped in one pass', () => {
    expect(oneLine('\n'.repeat(100_000))).toBe('\\n'.repeat(100_000));
  });
});
