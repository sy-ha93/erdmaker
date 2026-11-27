import { execFile } from 'node:child_process';
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
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
      `Unknown command: check\n${USAGE}\n`,
    ],
  ])('%s: 2 and the usage', async (_name, args, stderr) => {
    expect(await run(...args)).toEqual({ code: 2, stdout: '', stderr });
  });
});
