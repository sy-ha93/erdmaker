import { execFile, spawn } from 'node:child_process';
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const PACKAGE_DIR = fileURLToPath(new URL('../', import.meta.url));
const REPO_DIR = fileURLToPath(new URL('../../../', import.meta.url));
const EXAMPLES = 'format/v0/examples';
const EXAMPLE_DIR = join(REPO_DIR, EXAMPLES, 'shop');

const WANT =
  'OK: 10 entities, 11 relationships, 1 subtype clusters, 3 subject areas, 2 layouts, 5 words, 4 terms, 8 domains';
const USAGE = 'Usage: erdmaker validate <dir>';

let bin = '';
let base = '';

beforeAll(async () => {
  const manifest = JSON.parse(
    await readFile(join(PACKAGE_DIR, 'package.json'), 'utf8'),
  ) as { bin: { erdmaker: string } };
  bin = join(PACKAGE_DIR, manifest.bin.erdmaker);
  base = await mkdtemp(join(tmpdir(), 'erdmaker-cli-'));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the declared bin file as a child process, from the repository root. */
function run(...args: string[]): Promise<Run> {
  return new Promise((done) => {
    execFile(
      process.execPath,
      [bin, ...args],
      { cwd: REPO_DIR },
      (error, stdout, stderr) => {
        const code =
          error === null
            ? 0
            : typeof error.code === 'number'
              ? error.code
              : null;
        done({ code, stdout, stderr });
      },
    );
  });
}

let folders = 0;

/** A new empty folder under the test's temporary folder. */
async function folder(): Promise<string> {
  folders += 1;
  const dir = join(base, String(folders));
  await mkdir(dir);
  return dir;
}

/** A copy of the example at `dir`, with the one occurrence of `search` in `file` replaced. */
async function example(
  dir: string,
  change?: { file: string; search: string; replace: string },
): Promise<string> {
  await cp(EXAMPLE_DIR, dir, { recursive: true });
  if (change) {
    const path = join(dir, change.file);
    const text = await readFile(path, 'utf8');
    expect(text.split(change.search)).toHaveLength(2);
    await writeFile(path, text.replace(change.search, change.replace));
  }
  return dir;
}

describe('validate', () => {
  test('the example: 0 and the summary line', async () => {
    expect(await run('validate', `${EXAMPLES}/shop`)).toEqual({
      code: 0,
      stdout: `${WANT}\n`,
      stderr: '',
    });
  });

  test('the examples folder: 0 and the summary line after the model folder', async () => {
    expect(await run('validate', EXAMPLES)).toEqual({
      code: 0,
      stdout: `shop: ${WANT}\n`,
      stderr: '',
    });
  });

  test('a rule case: 1, the error with file, line and column, and the count', async () => {
    const dir = await example(await folder(), {
      file: 'entities/tag.yaml',
      search: '    domain: name\n',
      replace: '    domain: namex\n',
    });
    expect(await run('validate', dir)).toEqual({
      code: 1,
      stdout: '',
      stderr:
        'entities/tag.yaml:14:5: attribute "tag_nm": unknown domain "namex" [R02]\n' +
        '\n' +
        '1 error(s)\n',
    });
  });

  test('a comment only: 0, the warning, and the summary line', async () => {
    const dir = await example(await folder(), {
      file: 'subject-areas/party.yaml',
      search: 'group: master\n',
      replace: 'group: master # the master data\n',
    });
    expect(await run('validate', dir)).toEqual({
      code: 0,
      stdout: `${WANT}\n`,
      stderr:
        'subject-areas/party.yaml:3:15: warning: YAML comments are not kept when erdmaker rewrites this file [comment]\n',
    });
  });

  test('a project with two models of one id and a model inside a model: 1, P01 twice, P02, and no OK line for them', async () => {
    const project = await folder();
    await example(join(project, 'a'));
    await example(join(project, 'b'));
    const nesting = await example(join(project, 'c'), {
      file: 'model.yaml',
      search: 'id: shop\n',
      replace: 'id: shop_c\n',
    });
    await mkdir(join(nesting, 'inner'));
    await copyFile(
      join(nesting, 'model.yaml'),
      join(nesting, 'inner/model.yaml'),
    );
    await example(join(project, 'd'), {
      file: 'model.yaml',
      search: 'id: shop\n',
      replace: 'id: shop_d\n',
    });
    expect(await run('validate', project)).toEqual({
      code: 1,
      stdout: `d: ${WANT}\n`,
      stderr:
        'a/model.yaml:2:1: duplicate model id "shop" (also in b/model.yaml) [P01]\n' +
        'b/model.yaml:2:1: duplicate model id "shop" (also in a/model.yaml) [P01]\n' +
        'c/inner/model.yaml:1:1: model.yaml inside another model (c/model.yaml) [P02]\n' +
        '\n' +
        '3 error(s)\n',
    });
  });

  test('a model folder with a model.yaml inside: 1, P02, and no OK line', async () => {
    const dir = await example(await folder());
    await mkdir(join(dir, 'notes'));
    await copyFile(join(dir, 'model.yaml'), join(dir, 'notes/model.yaml'));
    expect(await run('validate', dir)).toEqual({
      code: 1,
      stdout: '',
      stderr:
        'notes/model.yaml:1:1: model.yaml inside another model (model.yaml) [P02]\n' +
        '\n' +
        '1 error(s)\n',
    });
  });

  test('errors of several models: each model’s errors, the total, and the OK lines of the others', async () => {
    const project = await folder();
    await example(join(project, 'a'), {
      file: 'entities/tag.yaml',
      search: '    domain: name\n',
      replace: '    domain: namex\n',
    });
    await example(join(project, 'b'), {
      file: 'model.yaml',
      search: 'id: shop\n',
      replace: 'id: shop_b\n',
    });
    await example(join(project, 'c'), {
      file: 'model.yaml',
      search: 'id: shop\n',
      replace: 'id: shop_c\nname: twice\n',
    });
    expect(await run('validate', project)).toEqual({
      code: 1,
      stdout: `b: ${WANT}\n`,
      stderr:
        'a/entities/tag.yaml:14:5: attribute "tag_nm": unknown domain "namex" [R02]\n' +
        'c/model.yaml:4:1: Map keys must be unique at line 4, column 1: [syntax]\n' +
        // Without the manifest the area groups are unknown.
        'c/subject-areas/catalog.yaml:3:1: unknown area group "master" [R12]\n' +
        'c/subject-areas/party.yaml:3:1: unknown area group "master" [R12]\n' +
        'c/subject-areas/sales.yaml:3:1: unknown area group "trade" [R12]\n' +
        '\n' +
        '5 error(s)\n',
    });
  });

  test.each([
    ['a folder without models', async () => folder(), 'No model found in'],
    [
      'a missing path',
      async () => join(await folder(), 'missing'),
      'Not a folder:',
    ],
    [
      'a file',
      async () => join(await example(await folder()), 'model.yaml'),
      'Not a folder:',
    ],
  ])('%s: 2 and the reason', async (_name, make, reason) => {
    const dir = await make();
    expect(await run('validate', dir)).toEqual({
      code: 2,
      stdout: '',
      stderr: `${reason} ${dir}\n`,
    });
  });

  test.each([
    ['no arguments', [], `${USAGE}\n`],
    ['validate without a folder', ['validate'], `${USAGE}\n`],
    ['validate with two folders', ['validate', 'a', 'b'], `${USAGE}\n`],
    [
      'an unknown command',
      ['check', 'a'],
      `Unknown command: check. ${USAGE}\n`,
    ],
  ])('%s: 2 and the usage', async (_name, args, stderr) => {
    expect(await run(...args)).toEqual({ code: 2, stdout: '', stderr });
  });

  test('a model folder whose name holds a newline: one OK line, the newline escaped', async () => {
    const project = await folder();
    await example(join(project, 'a\nb'));
    expect(await run('validate', project)).toEqual({
      code: 0,
      stdout: `a\\nb: ${WANT}\n`,
      stderr: '',
    });
  });

  test('an issue of a file whose name holds a newline and a tab: one line, both escaped', async () => {
    const dir = await example(await folder());
    await copyFile(
      join(dir, 'entities/tag.yaml'),
      join(dir, 'entities/x\ny\tz.yaml'),
    );
    expect(await run('validate', dir)).toEqual({
      code: 1,
      stdout: '',
      stderr:
        'entities/x\\ny\\tz.yaml:1:1: duplicate entity id "tag" (also in entities/tag.yaml) [R01]\n' +
        '\n' +
        '1 error(s)\n',
    });
  });
});

// Root reads through any permission, so the cases cannot happen there.
describe.skipIf(process.getuid?.() === 0)('validate: unreadable', () => {
  /** Runs `validate <dir>` with `locked` unreadable, then makes it readable again. */
  async function runLocked(dir: string, locked: string): Promise<Run> {
    await chmod(locked, 0o000);
    try {
      return await run('validate', dir);
    } finally {
      await chmod(locked, 0o755);
    }
  }

  /** Exit 2, nothing on stdout, and exactly one stderr line: `Cannot read <dir>: <the EACCES message>`. */
  function expectCannotRead(result: Run, dir: string): void {
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr.startsWith(`Cannot read ${dir}: EACCES: `)).toBe(true);
    expect(result.stderr.split('\n')).toEqual([result.stderr.slice(0, -1), '']);
  }

  test('an entity file: 2 and one line', async () => {
    const dir = await example(await folder());
    expectCannotRead(await runLocked(dir, join(dir, 'entities/tag.yaml')), dir);
  });

  test('the model folder: 2 and one line', async () => {
    const dir = await example(await folder());
    expectCannotRead(await runLocked(dir, dir), dir);
  });

  test('a folder without a model in a project: 2 and one line', async () => {
    const project = await folder();
    await example(join(project, 'a'));
    await mkdir(join(project, 'notes'));
    expectCannotRead(await runLocked(project, join(project, 'notes')), project);
  });

  test('the parent of the folder: 2 and one line, not "Not a folder"', async () => {
    const parent = await folder();
    const dir = await example(join(parent, 'm'));
    expectCannotRead(await runLocked(dir, parent), dir);
  });

  test('a dictionary folder outside the model: 2 and one line', async () => {
    const project = await folder();
    const dir = await example(join(project, 'm'), {
      file: 'model.yaml',
      search: 'targets:\n',
      replace: 'dictionaries:\n  - ../dictionary\ntargets:\n',
    });
    await rename(join(dir, 'dictionary'), join(project, 'dictionary'));
    expectCannotRead(await runLocked(dir, join(project, 'dictionary')), dir);
  });
});

describe('validate: closed output', () => {
  test('stdout closed after the first chunk: no stack, and the exit code of the rule', async () => {
    // Long folder names, so that the OK lines (about 128 KB) exceed a pipe's buffer.
    const project = await folder();
    const manifest = await readFile(join(EXAMPLE_DIR, 'model.yaml'), 'utf8');
    expect(manifest.split('id: shop\n')).toHaveLength(2);
    for (let i = 0; i < 400; i += 1) {
      const dir = join(project, `m${i}-${'x'.repeat(200)}`);
      await mkdir(dir);
      await writeFile(
        join(dir, 'model.yaml'),
        manifest.replace('id: shop\n', `id: shop_${i}\n`),
      );
    }
    const child = spawn(process.execPath, [bin, 'validate', project], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let chunks = 0;
    child.stdout.on('data', () => {
      chunks += 1;
      child.stdout.destroy();
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (text: string) => (stderr += text));
    const [code, signal] = await new Promise<[number | null, string | null]>(
      (done) => child.on('close', (...end) => done(end)),
    );
    expect(chunks).toBe(1);
    expect(stderr).not.toContain('node:events');
    expect(stderr).not.toMatch(/^\s*at /m);
    expect(stderr).toBe('');
    expect(signal).toBeNull();
    // Every model is clean: 0 if the run had ended when the pipe closed, 2 if not.
    expect([0, 2]).toContain(code);
  });
});
