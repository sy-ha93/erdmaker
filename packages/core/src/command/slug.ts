/** How much of a name the slug reads, in code units (spec FR-05). */
const READ_UNITS = 256;

/** The longest id the format takes (`$defs.id`). */
export const MAX_ID_LENGTH = 63;

/** A row of spec appendix C as written there: `-` adds nothing. */
const jamo = (row: string): readonly string[] =>
  row.split(' ').map((letters) => (letters === '-' ? '' : letters));

// Spec appendix C, in the Unicode jamo order.
const INITIALS = jamo('g kk n d tt r m b pp s ss - j jj ch k t p h');
const MEDIALS = jamo(
  'a ae ya yae eo e yeo ye o wa wae oe yo u wo we wi yu eu ui i',
);
const FINALS = jamo(
  '- k kk ks n nj nh t l lk lm lp ls lt lp lh m p ps s ss ng j ch k t p h',
);

const FIRST_SYLLABLE = 0xac00;
const LAST_SYLLABLE = 0xd7a3;

/** The letters of one code point, or `undefined` for a separator. */
function letters(code: number): string | undefined {
  if (code >= 0x61 && code <= 0x7a) return String.fromCharCode(code);
  if (code >= 0x30 && code <= 0x39) return String.fromCharCode(code);
  if (code >= 0x41 && code <= 0x5a) return String.fromCharCode(code + 0x20);
  if (code >= FIRST_SYLLABLE && code <= LAST_SYLLABLE) {
    const index = code - FIRST_SYLLABLE;
    return (
      INITIALS[Math.floor(index / 588)]! +
      MEDIALS[Math.floor((index % 588) / 28)]! +
      FINALS[index % 28]!
    );
  }
  return undefined;
}

/** Drops the `_` at the end. */
function trimEnd(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === '_') end -= 1;
  return text.slice(0, end);
}

/**
 * Text to id letters (spec FR-05): the first 256 code units, NFKC, `A`–`Z`
 * lower-cased, `a`–`z` and `0`–`9` kept, Hangul syllables romanized
 * (appendix C), everything else a separator; runs of separators become one
 * `_`, none at either end; at most 63 characters with no `_` at the end.
 * Empty when nothing is left. Never throws: a lone surrogate is a separator.
 */
export function slugify(text: string): string {
  const head = text.slice(0, READ_UNITS).normalize('NFKC');
  let out = '';
  let separated = false;
  for (const char of head) {
    const part = letters(char.codePointAt(0)!);
    if (part === undefined) {
      separated = out !== '';
      continue;
    }
    out += separated ? `_${part}` : part;
    separated = false;
    if (out.length >= MAX_ID_LENGTH) break;
  }
  return trimEnd(out.slice(0, MAX_ID_LENGTH));
}

/** `text` cut to 63 characters with no `_` at the end. */
export function fitId(text: string): string {
  return trimEnd(text.slice(0, MAX_ID_LENGTH));
}
