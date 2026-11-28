import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const COMMAND_DIR = fileURLToPath(new URL('./', import.meta.url));

/**
 * Array calls that scan or copy a list. In the handlers and the editor every
 * list and index change goes through `working.ts`, which reports its work
 * (plan decision 9); a call here would hide work from the work-count test.
 */
const FORBIDDEN =
  /\.(slice|filter|find|findIndex|map|concat|some|every|includes|indexOf|splice|sort|reverse)\(|\[\.\.\./;

/** A line may keep one of them with `// work-ok: <reason>` at its end. */
const ALLOWED = /\/\/ work-ok: \S.*$/;

/** The guarded files: the handlers and the editor, as `name → text`. */
function guardedFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const name of readdirSync(`${COMMAND_DIR}handlers`)) {
    if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      files.set(
        `handlers/${name}`,
        readFileSync(`${COMMAND_DIR}handlers/${name}`, 'utf8'),
      );
    }
  }
  files.set('editor.ts', readFileSync(`${COMMAND_DIR}editor.ts`, 'utf8'));
  return files;
}

/** The lines of `text` that use a forbidden call without a reason. */
function offenders(text: string): string[] {
  const out: string[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (FORBIDDEN.test(line) && !ALLOWED.test(line)) {
      out.push(`${i + 1}: ${line.trim()}`);
    }
    if (line.includes('// work-ok:') && !ALLOWED.test(line)) {
      out.push(`${i + 1}: a work-ok marker without a reason`);
    }
  }
  return out;
}

describe('일의 수: 목록을 고치는 길', () => {
  test('the handlers and the editor scan and copy lists only through working.ts', () => {
    const files = guardedFiles();
    expect(files.size).toBeGreaterThan(1);
    for (const [name, text] of files) {
      expect({ name, lines: offenders(text) }).toEqual({ name, lines: [] });
    }
  });

  test('the guard finds each forbidden call and takes a marker only with a reason', () => {
    for (const call of [
      'a.slice(1)',
      'a.filter(f)',
      'a.find(f)',
      'a.findIndex(f)',
      'a.map(f)',
      'a.concat(b)',
      'a.some(f)',
      'a.every(f)',
      'a.includes(x)',
      'a.indexOf(x)',
      'a.splice(0, 1)',
      'a.sort()',
      'a.reverse()',
      'const b = [...a];',
    ]) {
      expect(offenders(call)).toHaveLength(1);
      expect(offenders(`${call} // work-ok: one entity's attributes`)).toEqual(
        [],
      );
      expect(offenders(`${call} // work-ok:`)).toHaveLength(2);
    }
    expect(offenders('working.append(list, item);')).toEqual([]);
  });
});
