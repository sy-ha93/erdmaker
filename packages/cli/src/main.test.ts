import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import type { FileSystemAdapter } from '@erdmaker/core';
import { describe, expect, test } from 'vitest';
import {
  MAX_MESSAGE,
  type Stdio,
  cli,
  describeError,
  main,
  oneLine,
} from './main.js';

/** A real folder, so `main` gets past its folder check to the adapter. */
const DIR = fileURLToPath(new URL('.', import.meta.url));
const EXAMPLE = fileURLToPath(
  new URL('../../../format/v0/examples/shop', import.meta.url),
);
const OK =
  'OK: 10 entities, 11 relationships, 1 subtype clusters, 3 subject areas, 2 layouts, 5 words, 4 terms, 8 domains';

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

  test(`describeError keeps ${MAX_MESSAGE} code points and cuts a longer message with …`, () => {
    expect(MAX_MESSAGE).toBe(500);
    const full = 'a'.repeat(500);
    expect(describeError(new Error(full))).toBe(full);
    expect(describeError(new Error(`${full}b`))).toBe(`${full}…`);
    // A pair of surrogates is one code point and is never split.
    const pairs = '😀'.repeat(500);
    expect(describeError(`${pairs}😀`)).toBe(`${pairs}…`);
    expect(describeError(`x${pairs}`)).toBe(`x${'😀'.repeat(499)}…`);
  });

  test('a long rejection: the message part is cut, the line stays one', async () => {
    const { code, out, err } = await capture(new Error('m\n'.repeat(10_000)));
    expect({ code, out }).toEqual({ code: 2, out: [] });
    expect(err).toEqual([`Cannot read ${DIR}: ${'m\\n'.repeat(250)}…`]);
  });
});

/**
 * A stream that keeps what is written and can be made to fail. A write is
 * done at once, or with `later` when the test calls `finish`, as a pipe
 * that is not drained yet does it.
 */
class FakeStream extends EventEmitter {
  readonly written: string[] = [];
  private readonly pending: (() => void)[] = [];
  constructor(
    private readonly onWrite?: (stream: FakeStream) => void,
    private readonly later = false,
  ) {
    super();
  }
  write(text: string, done?: (error?: Error | null) => void): boolean {
    this.written.push(text);
    this.onWrite?.(this);
    if (this.later) this.pending.push(() => done?.());
    else done?.();
    return !this.later;
  }
  /** Completes the writes that wait. */
  finish(): void {
    for (const done of this.pending.splice(0)) done();
  }
}

const epipe = () => Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });

function stdio(stdout = new FakeStream(), stderr = new FakeStream()) {
  const exits: number[] = [];
  const io = {
    stdout: stdout as unknown as Stdio['stdout'],
    stderr: stderr as unknown as Stdio['stderr'],
    exitCode: undefined as Stdio['exitCode'],
    exit: (code: number) => void exits.push(code),
  };
  return { io, exits, stdout, stderr };
}

describe('validate: cli', () => {
  test('a clean run: the lines and the exit code, no exit call', async () => {
    const { io, exits, stdout, stderr } = stdio();
    await cli(['validate', EXAMPLE], io);
    expect(stdout.written).toEqual([`${OK}\n`]);
    expect(stderr.written).toEqual([]);
    expect({ code: io.exitCode, exits }).toEqual({ code: 0, exits: [] });
  });

  test('EPIPE before main returns: nothing more is written, exit 2', async () => {
    const stdout = new FakeStream((s) => s.emit('error', epipe()));
    const { io, exits, stderr } = stdio(stdout);
    await cli(['validate', EXAMPLE], io);
    expect(stdout.written).toEqual([`${OK}\n`]);
    expect(stderr.written).toEqual([]);
    expect({ code: io.exitCode, exits }).toEqual({
      code: undefined,
      exits: [2],
    });
  });

  test('EPIPE after main returned: exit with its code, nothing written', async () => {
    const { io, exits, stdout, stderr } = stdio();
    await cli(['validate', DIR], io);
    expect(io.exitCode).toBe(2);
    stderr.emit('error', epipe());
    stdout.emit('error', epipe());
    expect(exits).toEqual([2]);
    expect(stderr.written).toEqual([`No model found in ${DIR}\n`]);

    const clean = stdio();
    await cli(['validate', EXAMPLE], clean.io);
    clean.stdout.emit('error', epipe());
    expect(clean.exits).toEqual([0]);
    expect(clean.stderr.written).toEqual([]);
  });

  test('another stdout error: one Unexpected error line on stderr, exit 2', async () => {
    const stdout = new FakeStream((s) =>
      s.emit('error', new Error('disk\nfull')),
    );
    const { io, exits, stderr } = stdio(stdout);
    await cli(['validate', EXAMPLE], io);
    expect(stderr.written).toEqual(['Unexpected error: disk\\nfull\n']);
    expect({ code: io.exitCode, exits }).toEqual({
      code: undefined,
      exits: [2],
    });
  });

  test('another stdout error while stderr is slow: the exit waits for the line to be written', async () => {
    const stdout = new FakeStream((s) => s.emit('error', new Error('full')));
    const stderr = new FakeStream(undefined, true);
    const { io, exits } = stdio(stdout, stderr);
    await cli(['validate', EXAMPLE], io);
    expect(stderr.written).toEqual(['Unexpected error: full\n']);
    expect(exits).toEqual([]);
    stderr.finish();
    expect(exits).toEqual([2]);
    expect(io.exitCode).toBeUndefined();
  });

  test('a stderr error: nothing more is written, exit 2', async () => {
    const stderr = new FakeStream((s) => s.emit('error', new Error('gone')));
    const { io, exits, stdout } = stdio(undefined, stderr);
    await cli(['validate', DIR], io);
    expect(stderr.written).toEqual([`No model found in ${DIR}\n`]);
    expect(stdout.written).toEqual([]);
    expect({ code: io.exitCode, exits }).toEqual({
      code: undefined,
      exits: [2],
    });
  });

  test('an exception out of main: one Unexpected error line, cut, exit 2', async () => {
    const stdout = new FakeStream(() => {
      throw new Error('x'.repeat(600));
    });
    const { io, exits, stderr } = stdio(stdout);
    await cli(['validate', EXAMPLE], io);
    expect(stderr.written).toEqual([`Unexpected error: ${'x'.repeat(500)}…\n`]);
    expect({ code: io.exitCode, exits }).toEqual({ code: 2, exits: [] });
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

  test('C1 controls, bidirectional controls and lone surrogates are visible escapes', () => {
    expect(
      oneLine(
        'a\u0080b\u009fc\u202ad\u202ee\u2066f\u2069g\ud800h\udfffi\udc00\ud800',
      ),
    ).toBe(
      'a\\u{80}b\\u{9f}c\\u{202a}d\\u{202e}e\\u{2066}f\\u{2069}g\\u{d800}h\\u{dfff}i\\u{dc00}\\u{d800}',
    );
  });

  test('neighbours of the escaped ranges and a surrogate pair are unchanged', () => {
    const text = '\u00a0\u2027\u202f\u2065\u206a😀\ud83d\ude00';
    expect(oneLine(text)).toBe(text);
  });

  test('a long text of controls is escaped in one pass', () => {
    expect(oneLine('\n'.repeat(100_000))).toBe('\\n'.repeat(100_000));
    expect(oneLine('\ud800'.repeat(100_000))).toBe('\\u{d800}'.repeat(100_000));
  });
});
