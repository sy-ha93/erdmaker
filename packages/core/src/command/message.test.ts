import { describe, expect, test } from 'vitest';
import { AWKWARD_STRINGS, Random, randomString } from '../testing/generate.js';
import { oneLineMessage } from './message.js';

describe('거부 문구: 한 줄', () => {
  test.each([
    ['a\nb', 'a\\nb'],
    ['a\rb', 'a\\rb'],
    ['a\tb', 'a\\tb'],
    ['\u0000', '\\u{0}'],
    ['\u001b[31m', '\\u{1b}[31m'],
    ['\u001f', '\\u{1f}'],
    ['\u007f', '\\u{7f}'],
    ['\u0085', '\\u{85}'],
    ['\u009f', '\\u{9f}'],
    ['\u2028\u2029', '\\u{2028}\\u{2029}'],
    ['\u202a\u202e', '\\u{202a}\\u{202e}'],
    ['\u2066\u2069', '\\u{2066}\\u{2069}'],
    ['\ud800', '\\u{d800}'],
    ['x\udfffy', 'x\\u{dfff}y'],
  ])('escapes %j as %j', (text, escaped) => {
    expect(oneLineMessage(text)).toBe(escaped);
  });

  test('keeps the backslash, a surrogate pair and the characters around the escaped ranges', () => {
    // Just outside each escaped range: U+00A0, U+2027, U+202F, U+2065, U+206A, U+E000.
    const around = String.fromCodePoint(
      0xa0,
      0x2027,
      0x202f,
      0x2065,
      0x206a,
      0xe000,
    );
    const kept = `a\\b \\n 🙂 é 한글 ${around}`;
    expect(oneLineMessage(kept)).toBe(kept);
  });

  test('keeps 500 code points and cuts 501 to 500 and an ellipsis', () => {
    expect(oneLineMessage('a'.repeat(500))).toBe('a'.repeat(500));
    expect(oneLineMessage('a'.repeat(501))).toBe(`${'a'.repeat(500)}…`);
    // A pair is one code point: 500 of them are 1000 code units.
    expect(oneLineMessage('🙂'.repeat(500))).toBe('🙂'.repeat(500));
    expect(oneLineMessage(`${'🙂'.repeat(500)}a`)).toBe(`${'🙂'.repeat(500)}…`);
    expect(oneLineMessage(`${'a'.repeat(499)}🙂🙂`)).toBe(
      `${'a'.repeat(499)}🙂…`,
    );
  });

  test('never cuts inside an escape it wrote: the cut moves to before it', () => {
    const sep = ' ';
    // `\u{2028}` is 8 code points.
    expect(oneLineMessage(`${'a'.repeat(497)}${sep}`)).toBe(
      `${'a'.repeat(497)}…`,
    );
    expect(oneLineMessage(`${'a'.repeat(493)}${sep}`)).toBe(
      `${'a'.repeat(493)}…`,
    );
    expect(oneLineMessage(`${'a'.repeat(492)}${sep}`)).toBe(
      `${'a'.repeat(492)}\\u{2028}`,
    );
    expect(oneLineMessage(`${'a'.repeat(492)}${sep}b`)).toBe(
      `${'a'.repeat(492)}\\u{2028}…`,
    );
    expect(oneLineMessage(`${'a'.repeat(497)}${sep}${sep}`)).toBe(
      `${'a'.repeat(497)}…`,
    );
    expect(oneLineMessage(`${'a'.repeat(499)}\n`)).toBe(`${'a'.repeat(499)}…`);
    expect(oneLineMessage(`${'a'.repeat(498)}\t`)).toBe(
      `${'a'.repeat(498)}\\t`,
    );
    expect(oneLineMessage(`${'a'.repeat(498)}\r!`)).toBe(
      `${'a'.repeat(498)}\\r…`,
    );
    expect(oneLineMessage(`${'a'.repeat(495)}\u0000`)).toBe(
      `${'a'.repeat(495)}\\u{0}`,
    );
    expect(oneLineMessage(`${'a'.repeat(496)}\u0000`)).toBe(
      `${'a'.repeat(496)}…`,
    );
  });

  test('a backslash of the text itself is cut like any character', () => {
    expect(oneLineMessage(`${'a'.repeat(499)}\\n`)).toBe(
      `${'a'.repeat(499)}\\…`,
    );
  });

  test('stops at the cut: a million line breaks give 250 escapes and an ellipsis', () => {
    expect(oneLineMessage('\n'.repeat(1_000_000))).toBe(
      `${'\\n'.repeat(250)}…`,
    );
  });

  test('counts code points after escaping', () => {
    // 100 newlines become 200 characters.
    expect(oneLineMessage(`${'\n'.repeat(100)}${'a'.repeat(300)}`)).toBe(
      `${'\\n'.repeat(100)}${'a'.repeat(300)}`,
    );
    expect(oneLineMessage(`${'\n'.repeat(100)}${'a'.repeat(301)}`)).toBe(
      `${'\\n'.repeat(100)}${'a'.repeat(300)}…`,
    );
  });

  test('never throws and never leaves a line break, for awkward and random text', () => {
    const random = new Random(3);
    const texts = [...AWKWARD_STRINGS];
    for (let i = 0; i < 2000; i += 1) texts.push(randomString(random));
    for (const text of texts) {
      const line = oneLineMessage(text);
      expect(line).not.toMatch(
        // eslint-disable-next-line no-control-regex
        /[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069\ud800-\udfff]/u,
      );
      expect([...line].length).toBeLessThanOrEqual(501);
    }
  });
});
