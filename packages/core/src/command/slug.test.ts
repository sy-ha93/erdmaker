import { describe, expect, test } from 'vitest';
import { AWKWARD_STRINGS, Random, randomString } from '../testing/generate.js';
import { slugify } from './slug.js';

const SLUG = /^[a-z0-9][a-z0-9_]{0,62}$/;

describe('ID 만들기: 슬러그', () => {
  // Spec AC-08: the names whose slug is not empty.
  test.each([
    ['Order Item', 'order_item'],
    ['ORD_NO', 'ord_no'],
    ['고객', 'gogaek'],
    ['주문번호', 'jumunbeonho'],
    ['값', 'gaps'],
    ['닭', 'dalk'],
    ['읽기', 'ilkgi'],
    ['엔터티', 'enteoti'],
    ['  __proto__  ', 'proto'],
    ['constructor', 'constructor'],
    ['ＡＢＣ１', 'abc1'],
    ['café', 'caf'],
    ['a--b__c', 'a_b_c'],
    ['123', '123'],
    ['a'.repeat(70), 'a'.repeat(63)],
    ['값'.repeat(20), `${'gaps'.repeat(15)}gap`],
    ['CUSTOMER_V2', 'customer_v2'],
  ])('%j → %j', (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });

  test.each([
    ['漢字'],
    ['🙂'],
    ['___'],
    [' \t\n　 '],
    [''],
    [`${' '.repeat(256)}abc`],
    [`${'-'.repeat(256)}abc`],
  ])('%j has an empty slug', (name) => {
    expect(slugify(name)).toBe('');
  });

  test('reads only the first 256 code units', () => {
    expect(slugify(`${' '.repeat(255)}ab`)).toBe('a');
    // A pair cut in half by the limit leaves a lone surrogate: a separator.
    expect(slugify(`${'a'.repeat(255)}🙂b`)).toBe('a'.repeat(63));
    // Cut first, then NFKC: normalizing first would grow `ﬁ` past the limit
    // and shrink the decomposed `값` (three units) inside it.
    expect(slugify(`${'-'.repeat(255)}ﬁ`)).toBe('fi');
    expect(slugify(`${'-'.repeat(254)}값`)).toBe('ga');
  });

  test('compatibility jamo compose into a syllable', () => {
    expect(slugify('ㄱㅏ')).toBe('ga');
  });

  test('cuts to 63 characters and drops the separator it ends on', () => {
    expect(slugify(`${'a'.repeat(62)} b`)).toBe('a'.repeat(62));
    expect(slugify(`${'a'.repeat(61)} bc`)).toBe(`${'a'.repeat(61)}_b`);
    // Cut inside a syllable's letters.
    expect(slugify(`${'a'.repeat(61)} 값`)).toBe(`${'a'.repeat(61)}_g`);
  });

  test('NFKC comes first: decomposed syllables, compatibility letters, the Kelvin sign', () => {
    expect(slugify('값')).toBe('gaps');
    expect(slugify('ﬁle')).toBe('file');
    expect(slugify('K')).toBe('k');
    expect(slugify('①②')).toBe('12');
  });

  test('the examples of appendix C', () => {
    expect(slugify('고객')).toBe('gogaek');
    expect(slugify('주문번호')).toBe('jumunbeonho');
    expect(slugify('값')).toBe('gaps');
    expect(slugify('닭')).toBe('dalk');
    expect(slugify('읽기')).toBe('ilkgi');
    expect(slugify('배송')).toBe('baesong');
    expect(slugify('엔터티')).toBe('enteoti');
  });

  test('the first and last letters of each row of appendix C', () => {
    // 가: g a -, 힣: h i h, 앙: - a ng, 갛: g a h, 깨: kk ae, 읬: - ui ss.
    expect(slugify('가')).toBe('ga');
    expect(slugify('힣')).toBe('hih');
    expect(slugify('앙')).toBe('ang');
    expect(slugify('갛')).toBe('gah');
    expect(slugify('깨')).toBe('kkae');
    expect(slugify('읬')).toBe('uiss');
  });

  test('every letter of appendix C at its place', () => {
    const row = (text: string) =>
      text.split(' ').map((letters) => (letters === '-' ? '' : letters));
    const initials = row('g kk n d tt r m b pp s ss - j jj ch k t p h');
    const medials = row(
      'a ae ya yae eo e yeo ye o wa wae oe yo u wo we wi yu eu ui i',
    );
    const finals = row(
      '- k kk ks n nj nh t l lk lm lp ls lt lp lh m p ps s ss ng j ch k t p h',
    );
    expect([initials.length, medials.length, finals.length]).toEqual([
      19, 21, 28,
    ]);
    const syllable = (i: number, m: number, f: number) =>
      String.fromCharCode(0xac00 + i * 588 + m * 28 + f);
    initials.forEach((letters, i) => {
      expect(slugify(syllable(i, 0, 0))).toBe(`${letters}a`);
    });
    medials.forEach((letters, m) => {
      expect(slugify(syllable(11, m, 0))).toBe(letters);
    });
    finals.forEach((letters, f) => {
      expect(slugify(syllable(0, 0, f))).toBe(`ga${letters}`);
    });
  });

  test('every Hangul syllable becomes letters', () => {
    for (let code = 0xac00; code <= 0xd7a3; code += 1) {
      const slug = slugify(String.fromCharCode(code));
      if (!/^[a-z]+$/.test(slug) || slug.includes('undefined')) {
        throw new Error(`U+${code.toString(16)} → ${JSON.stringify(slug)}`);
      }
    }
  });

  test('awkward and random text never throws and gives an empty slug or an id', () => {
    const random = new Random(3);
    const texts = [...AWKWARD_STRINGS];
    for (let i = 0; i < 2000; i += 1) texts.push(randomString(random));
    texts.push('\ud800'.repeat(1000), 'a'.repeat(1_000_000), '\u0000\u001f');
    for (const text of texts) {
      const slug = slugify(text);
      if (slug === '') continue;
      expect(slug).toMatch(SLUG);
      expect(slug.endsWith('_')).toBe(false);
    }
  });
});
