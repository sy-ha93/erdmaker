import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const COMMAND_DIR = fileURLToPath(new URL('./', import.meta.url));

/**
 * Calls and syntax that scan or copy a list. Under `command/` every list and
 * index change of a command goes through `working.ts`, which reports its
 * work (plan decision 9); one of these here would hide work from the
 * work-count tests. A bracket access by a quoted name (`a['slice'](…)`, the
 * `[` right after the value as the formatter writes it) counts; a list
 * literal of strings (`['a', 'b']`, `of ['a']`) does not.
 */
const FORBIDDEN = new RegExp(
  [
    String.raw`\.\s*(?:slice|filter|find|findIndex|findLast|findLastIndex|map|flatMap|flat|concat|some|every|includes|indexOf|lastIndexOf|splice|toSpliced|sort|toSorted|reverse|toReversed|forEach|reduce|reduceRight|join|entries|values|keys|fill|unshift)\s*\(`,
    String.raw`\bArray\.from\b`,
    String.raw`\bObject\.(?:values|entries|keys)\b`,
    String.raw`\bstructuredClone\b`,
    String.raw`(?:[\w$)\]]|\?\.)\[\s*['"\x60]`,
    String.raw`\.\.\.`,
  ].join('|'),
);

/**
 * A line may keep one of them with `// work-ok: <reason>` at its end, or on
 * a line of its own just above it (where the formatter keeps a comment for
 * a line that opens a block).
 */
const MARKER = /\/\/ work-ok:(.*)$/;

/**
 * The files under `command/` that are not scanned, each with why. Every
 * other `.ts` file is, so a new file is guarded until it is listed here.
 */
const UNGUARDED: ReadonlyMap<string, string> = new Map([
  ['working.ts', 'the helpers that do the list work and report it'],
  ['check.ts', 'checks the shape of a command; never sees the model'],
  ['copy.ts', 'copies the command value; never sees the model'],
  ['message.ts', 'makes the text of a refusal one line'],
  ['schemas.ts', 'the command schemas, built once when the module loads'],
  ['slug.ts', 'turns one text into an id; strings only'],
  ['types.ts', 'types only; no code runs'],
]);

/** Every non-test `.ts` file under `command/`, by its path there. */
function commandFiles(dir = '', out: string[] = []): string[] {
  for (const entry of readdirSync(`${COMMAND_DIR}${dir}`, {
    withFileTypes: true,
  })) {
    const name = `${dir}${entry.name}`;
    if (entry.isDirectory()) commandFiles(`${name}/`, out);
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(name);
  }
  return out;
}

/** The guarded files, as `name → text`. */
function guardedFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const name of commandFiles()) {
    if (!UNGUARDED.has(name)) {
      files.set(name, readFileSync(`${COMMAND_DIR}${name}`, 'utf8'));
    }
  }
  return files;
}

/** The lines of `text` that use a forbidden form without a reason, or carry an empty marker. */
function offenders(text: string): string[] {
  const out: string[] = [];
  const lines = text.split('\n');
  let above = '';
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const marker = MARKER.exec(line);
    const reason = marker?.[1]!.trim() ?? '';
    if (marker && reason === '') {
      out.push(`${i + 1}: a work-ok marker without a reason`);
    }
    const code = marker ? line.slice(0, marker.index) : line;
    if (marker && code.trim() === '') {
      // A marker of its own covers the next line only.
      above = reason;
      continue;
    }
    if (FORBIDDEN.test(code) && reason === '' && above === '') {
      out.push(`${i + 1}: ${line.trim()}`);
    }
    above = '';
  }
  return out;
}

/** The marked lines of `text`: each marker's reason and the code it covers. */
function markers(text: string): { reason: string; code: string }[] {
  const out: { reason: string; code: string }[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const marker = MARKER.exec(lines[i]!);
    if (!marker) continue;
    const code = lines[i]!.slice(0, marker.index);
    out.push({
      reason: marker[1]!.trim(),
      code: code.trim() === '' ? (lines[i + 1] ?? '') : code,
    });
  }
  return out;
}

describe('일의 수: 목록을 고치는 길', () => {
  test('the files under command/ scan and copy lists only through working.ts', () => {
    const all = commandFiles();
    for (const name of UNGUARDED.keys()) expect(all).toContain(name);
    for (const reason of UNGUARDED.values()) expect(reason.trim()).not.toBe('');
    const files = guardedFiles();
    expect([...files.keys()]).toEqual(
      expect.arrayContaining(['editor.ts', 'changes.ts', 'handlers/entity.ts']),
    );
    for (const [name, text] of files) {
      expect({ name, lines: offenders(text) }).toEqual({ name, lines: [] });
    }
  });

  test('every work-ok marker in the guarded files gives a reason', () => {
    let count = 0;
    for (const text of guardedFiles().values()) {
      for (const { reason, code } of markers(text)) {
        count += 1;
        expect(reason.length, code).toBeGreaterThan(0);
        // A marker stands only where the guard would otherwise fail.
        expect(FORBIDDEN.test(code), code).toBe(true);
      }
    }
    expect(count).toBeGreaterThan(0);
  });

  test('the guard finds each forbidden form and takes a marker only with a reason', () => {
    const calls = [
      'slice',
      'filter',
      'find',
      'findIndex',
      'findLast',
      'findLastIndex',
      'map',
      'flatMap',
      'flat',
      'concat',
      'some',
      'every',
      'includes',
      'indexOf',
      'lastIndexOf',
      'splice',
      'toSpliced',
      'sort',
      'toSorted',
      'reverse',
      'toReversed',
      'forEach',
      'reduce',
      'reduceRight',
      'join',
      'entries',
      'values',
      'keys',
      'fill',
      'unshift',
    ].map((name) => `a.${name}(f)`);
    for (const form of [
      ...calls,
      'a . map (f)',
      'a\t.filter\t(f)',
      'a?.map(f)',
      'Array.from(a)',
      'Array.from(working.ownSubjectArea(0).entities)',
      'Object.values(o)',
      'Object.entries(o)',
      'Object.keys(o)',
      'const k = Object.keys;',
      'structuredClone(a)',
      "a['slice'](0)",
      'a["map"](f)',
      'a[`filter`](f)',
      "a[ 'sort' ]()",
      "a?.['find'](f)",
      "f()['map'](g)",
      "a[0]['slice'](1)",
      'const b = [...a];',
      'f(...a);',
      'const o = { ...p };',
      'const { x, ...rest } = o;',
    ]) {
      expect(offenders(form), form).toHaveLength(1);
      expect(
        offenders(`${form} // work-ok: one entity's attributes`),
        form,
      ).toEqual([]);
      expect(offenders(`${form} // work-ok:`), form).toHaveLength(2);
      expect(offenders(`${form} // work-ok:   `), form).toHaveLength(2);
    }
  });

  test('the guard does not flag the helper calls or list literals', () => {
    for (const line of [
      'working.append(list, item);',
      "working.append('subjectAreas', { file, data });",
      'working.addToArea(found.position, entity);',
      'working.removeFromArea(found.position, command.entities);',
      'working.removeAreaNodes(command.id, command.entities);',
      'working.removeFromKeys(owner, id);',
      'working.moveMember(target.entity, member, target.position, before);',
      'const data = working.ownSubjectArea(found.position);',
      'const space = working.memberSpace(owner, member, entity);',
      'const found = findMember(working, owner, entity, member, id);',
      "noteWork('index-build', start.length);",
      "const FIELDS = ['definition', 'group', 'order'] as const;",
      "  ['entities', 'entity'],",
      "for (const name of unset ?? ['dictionary']) {",
      "for (const folder of ['entities', 'subject-areas'] as const) {",
      "return ['a'];",
      'const first = issues[0]!;',
      '// The work-ok marker needs a reason.',
    ]) {
      expect(offenders(line), line).toEqual([]);
    }
  });

  test('a marker on a line of its own covers the next line only', () => {
    const marked = '// work-ok: the set record of one command';
    expect(offenders(`${marked}\nfor (const k of Object.keys(o)) {`)).toEqual(
      [],
    );
    expect(offenders(`  ${marked}\n  a.map(f);`)).toEqual([]);
    expect(offenders(`${marked}\nx = 1;\na.map(f);`)).toEqual(['3: a.map(f);']);
    expect(offenders(`// work-ok:\na.map(f);`)).toEqual([
      '1: a work-ok marker without a reason',
      '2: a.map(f);',
    ]);
    expect(markers(`${marked}\na.map(f);`)).toEqual([
      { reason: 'the set record of one command', code: 'a.map(f);' },
    ]);
  });
});
