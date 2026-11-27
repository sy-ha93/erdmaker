import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createNodeFileSystem } from './node/fs.js';
import { validateProject } from './project/validate.js';
import { caseFiles, RULE_CASES, type RuleCase } from './testing/cases.js';
import { exampleFiles, type Files, replaceOnce } from './testing/example.js';

/**
 * FR-13 step 1: the old checker and the new one agree on the example and on
 * every case of Appendix A not left out on purpose. Both run on the same
 * folder on disk; compared are the exit code and the multiset of
 * `<file>: <message>` lines. Deleted with the old checker (FR-13 step 2).
 */
const OLD_TOOL = fileURLToPath(
  new URL('../../../tools/validate-format.mjs', import.meta.url),
);

/** A model folder on disk and the folder the old tool is run on. */
interface ParityCase {
  name: string;
  /** Files relative to the project folder. */
  files: Files;
  /** The model folder in the project folder. */
  model: string;
  /** A line the old output must hold, so the case shows what it is named for. */
  shows?: string;
}

/** A line of the old output starts an error when its file part ends with `.yaml` or `.json` (analysis 4.9). */
const ERROR_START = /^(.+?\.(?:yaml|json)): (.*)$/;

/**
 * The old tool's error lines. A YAML syntax message spans several lines, with
 * a code frame whose lines may look like `id: tag`; those, the blank line and
 * the `<n> error(s)` line are not errors.
 */
function oldLines(stderr: string): string[] {
  return stderr.split('\n').filter((line) => ERROR_START.test(line));
}

interface Outcome {
  code: number | null;
  lines: string[];
}

function runOldTool(dir: string): Promise<Outcome & { stderr: string }> {
  return new Promise((done) => {
    execFile(process.execPath, [OLD_TOOL, dir], (error, _stdout, stderr) => {
      const code =
        error === null ? 0 : typeof error.code === 'number' ? error.code : null;
      done({ code, lines: oldLines(stderr).sort(), stderr });
    });
  });
}

/** The new checker on the model folder, as the CLI runs it; errors only, P01 and P02 left out, first message lines. */
async function runNew(dir: string): Promise<Outcome> {
  const project = await validateProject(createNodeFileSystem(dir), '');
  const lines = project.models
    .flatMap((model) => model.issues)
    .filter((issue) => issue.severity === 'error')
    .map((issue) => `${issue.file}: ${issue.message.split('\n')[0]}`);
  const errors = lines.length + project.issues.length;
  return { code: errors > 0 ? 1 : 0, lines: lines.sort() };
}

let base = '';

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'erdmaker-parity-'));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

/** Writes the case into a new folder; the model folder's path. */
async function writeCase(parity: ParityCase): Promise<string> {
  const root = await mkdtemp(join(base, 'case-'));
  for (const [path, text] of Object.entries(parity.files)) {
    const full = join(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, text, 'utf8');
  }
  return join(root, parity.model);
}

/** The example without its dictionary folder, which reads `../dictionary` instead. */
function outsideDictionary(): Files {
  const files = exampleFiles();
  const dictionary = files['dictionary/standard.yaml'];
  if (dictionary === undefined) throw new Error('No dictionary');
  delete files['dictionary/standard.yaml'];
  const model = replaceOnce(
    files,
    'model.yaml',
    'targets:\n',
    'dictionaries:\n  - ../dictionary\ntargets:\n',
  );
  const project: Files = {
    'dictionary/standard.yaml': replaceOnce(
      { dictionary },
      'dictionary',
      '      - nm\n',
      '      - nmx\n',
    ).dictionary!,
  };
  for (const [path, text] of Object.entries(model)) project[`m/${path}`] = text;
  return project;
}

const TAG = 'entities/tag.yaml';

const COMPARED_RULES = RULE_CASES.filter(
  (rule) => rule.parityExcluded === undefined,
);
const ruleCaseName = (rule: RuleCase) => `rule case: ${rule.name}`;

const CASES: ParityCase[] = [
  { name: 'the example', files: exampleFiles(), model: '' },
  ...COMPARED_RULES.map((rule): ParityCase => ({
    name: ruleCaseName(rule),
    files: caseFiles(rule),
    model: '',
  })),
  {
    name: 'a project whose dictionary is outside the model, with an error in it',
    files: outsideDictionary(),
    model: 'm',
    shows: '../dictionary/standard.yaml: term "cust_nm": unknown word "nmx"',
  },
  {
    // The file leaves the model, and the errors that follow must agree too.
    name: 'a YAML syntax error: a duplicate key',
    files: replaceOnce(
      exampleFiles(),
      TAG,
      'name: 태그\n',
      'name: 태그\nname: x\n',
    ),
    model: '',
    shows: 'entities/tag.yaml: Map keys must be unique at line 3, column 1:',
  },
  {
    name: 'a YAML syntax error: an unclosed flow sequence',
    files: replaceOnce(exampleFiles(), TAG, 'id: tag\n', 'id: [tag\n'),
    model: '',
    shows:
      'entities/tag.yaml: Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 1:',
  },
];

const CASE_BY_NAME = new Map(CASES.map((parity) => [parity.name, parity]));
const prepared = new Map<
  string,
  Promise<{ dir: string; old: Outcome & { stderr: string } }>
>();

/** The case on disk and the old tool's outcome on it; once per case, shared by the tests. */
function prepare(
  parity: ParityCase,
): Promise<{ dir: string; old: Outcome & { stderr: string } }> {
  let pending = prepared.get(parity.name);
  if (pending === undefined) {
    pending = writeCase(parity).then(async (dir) => ({
      dir,
      old: await runOldTool(dir),
    }));
    prepared.set(parity.name, pending);
  }
  return pending;
}

describe('대조', () => {
  test.concurrent.each(CASES.map((parity) => [parity.name, parity] as const))(
    '%s',
    { timeout: 30_000 },
    async (_name, parity) => {
      const { dir, old } = await prepare(parity);
      // The old tool ran: it ends with a count or a summary, not a crash.
      expect(old.code === 0 || /\n\d+ error\(s\)\n$/.test(old.stderr)).toBe(
        true,
      );
      if (parity.shows !== undefined) expect(old.lines).toContain(parity.shows);
      expect(await runNew(dir)).toEqual({ code: old.code, lines: old.lines });
    },
  );

  test(
    'every row 1 to 37 of Appendix A has a compared case on which the old tool reports an error',
    { timeout: 120_000 },
    async () => {
      // A case without errors would compare nothing of its row's rule.
      const rows = new Set<number>();
      for (const rule of COMPARED_RULES) {
        const { old } = await prepare(CASE_BY_NAME.get(ruleCaseName(rule))!);
        if (old.lines.length > 0) for (const row of rule.rows) rows.add(row);
      }
      const missing = Array.from({ length: 37 }, (_, i) => i + 1).filter(
        (row) => !rows.has(row),
      );
      expect(missing).toEqual([]);
    },
  );

  test('every case left out says why', () => {
    const left = RULE_CASES.filter((rule) => rule.parityExcluded !== undefined);
    expect(left.length).toBeGreaterThan(0);
    for (const rule of left) {
      expect(rule.parityExcluded, rule.name).toMatch(/^FR-13: \S/);
    }
  });

  test('a code frame line of the old output is not an error', () => {
    expect(
      oldLines(
        'entities/tag.yaml: Map keys must be unique at line 3, column 1:\n' +
          '\n' +
          'name: 태그\n' +
          'name: x\n' +
          '^\n' +
          '\n' +
          'layouts/sales.json: node for unknown entity "tag"\n' +
          '\n' +
          '2 error(s)\n',
      ),
    ).toEqual([
      'entities/tag.yaml: Map keys must be unique at line 3, column 1:',
      'layouts/sales.json: node for unknown entity "tag"',
    ]);
  });
});
