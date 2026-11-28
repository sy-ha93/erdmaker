/**
 * C0 controls, DEL, C1 controls, the Unicode line and paragraph separators,
 * the bidirectional embedding, override and isolate controls, and (with the
 * `u` flag a pair is one character) lone surrogates. The same set as the
 * CLI's `oneLine` (F02 FR-11), kept apart so the core needs nothing from it.
 */
const LINE_BREAKING =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069\ud800-\udfff]/gu;

const SHORT_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['\n', '\\n'],
  ['\r', '\\r'],
  ['\t', '\\t'],
]);

/** The most code points of a rejection message (spec FR-03). */
const MAX_CODE_POINTS = 500;

const BREAKING_CHAR = new RegExp(`^${LINE_BREAKING.source}$`, 'u');

/**
 * A rejection message as one line (spec FR-03): every character of
 * `LINE_BREAKING` written as `\n`, `\r`, `\t` or `\u{<lowercase hex>}`, the
 * backslash and every other character as they are; then, when longer than
 * 500 code points, the first 500 and `…`. An escape this function wrote is
 * never cut: when it would not fit whole, the cut moves to before it. One
 * pass that stops at the cut.
 */
export function oneLineMessage(text: string): string {
  let out = '';
  let count = 0;
  for (const char of text) {
    const escaped = BREAKING_CHAR.test(char)
      ? (SHORT_ESCAPES.get(char) ?? `\\u{${char.codePointAt(0)!.toString(16)}}`)
      : char;
    // An escape is ASCII: its length is its code points.
    const size = escaped === char ? 1 : escaped.length;
    if (count + size > MAX_CODE_POINTS) return `${out}…`;
    out += escaped;
    count += size;
  }
  return out;
}
