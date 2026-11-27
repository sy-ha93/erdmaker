import { stat } from 'node:fs/promises';
import {
  type FileSystemAdapter,
  type Issue,
  validateProject,
} from '@erdmaker/core';
import { createNodeFileSystem } from '@erdmaker/core/node';

/** Where the command writes, one line per call. */
export interface Output {
  out(line: string): void;
  err(line: string): void;
}

const processOutput: Output = {
  out: (line) => void process.stdout.write(`${line}\n`),
  err: (line) => void process.stderr.write(`${line}\n`),
};

const USAGE = 'Usage: erdmaker validate <dir>';

/** C0 controls, DEL, NEL, and the Unicode line and paragraph separators. */
// eslint-disable-next-line no-control-regex
const LINE_BREAKING = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/g;
const SHORT_ESCAPES: Readonly<Record<string, string>> = {
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};

/**
 * `text` with every character that could end or garble a terminal line
 * written as a visible escape (spec FR-11): `\n`, `\r`, `\t`, otherwise
 * `\u{<hex>}` in lowercase hex. Other characters, the backslash included,
 * stay as they are, so an ordinary path prints unchanged.
 */
export function oneLine(text: string): string {
  return text.replace(
    LINE_BREAKING,
    (char) =>
      SHORT_ESCAPES[char] ?? `\\u{${char.codePointAt(0)!.toString(16)}}`,
  );
}

/** An error's message, or the value as a string; never throws. */
export function describeError(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return 'unknown error';
  }
}

/** `<file>:<line>:<column>: <message> [<rule>]`, `warning: ` before the message of a warning. */
function issueLine(issue: Issue): string {
  const at =
    issue.line === undefined || issue.column === undefined
      ? ''
      : `:${issue.line}:${issue.column}`;
  const warning = issue.severity === 'warning' ? 'warning: ' : '';
  return `${issue.file}${at}: ${warning}${issue.message} [${issue.rule}]`;
}

/** Whether `file` (relative to the opened folder) is in the model folder `dir`. */
const inFolder = (dir: string, file: string) =>
  dir === '' || file.startsWith(`${dir}/`);

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * `erdmaker validate <dir>`: checks the models in `dir`, a model folder or a
 * project folder (spec FR-11). Returns the exit code: 0 when no model has an
 * error (warnings do not count), 1 when a model has an error, 2 when the
 * check could not run: a usage error (no or unknown command), `dir` not a
 * folder, no model found, or a failure to read the folder (the adapter
 * rejected, e.g. `EACCES`; reported as `Cannot read <dir>: <message>`, with
 * nothing on stdout). Every line written is escaped by `oneLine`, so one
 * record is one line. `open` makes the adapter over `dir`.
 */
export async function main(
  args: readonly string[],
  output: Output = processOutput,
  open: (dir: string) => FileSystemAdapter = createNodeFileSystem,
): Promise<number> {
  const out = (line: string) => output.out(oneLine(line));
  const err = (line: string) => output.err(oneLine(line));
  const [command, dir, ...rest] = args;
  if (command !== undefined && command !== 'validate') {
    err(`Unknown command: ${command}. ${USAGE}`);
    return 2;
  }
  if (dir === undefined || rest.length > 0) {
    err(USAGE);
    return 2;
  }
  if (!(await isFolder(dir))) {
    err(`Not a folder: ${dir}`);
    return 2;
  }
  let project;
  try {
    project = await validateProject(open(dir), '');
  } catch (error) {
    err(`Cannot read ${dir}: ${describeError(error)}`);
    return 2;
  }
  if (project.models.length === 0) {
    err(`No model found in ${dir}`);
    return 2;
  }

  let errors = 0;
  const report = (issue: Issue) => {
    if (issue.severity === 'error') errors += 1;
    err(issueLine(issue));
  };
  for (const issue of project.issues) report(issue);
  const ok: string[] = [];
  for (const model of project.models) {
    for (const issue of model.issues) report(issue);
    const failed =
      model.issues.some((issue) => issue.severity === 'error') ||
      project.issues.some((issue) => inFolder(model.dir, issue.file));
    if (failed) continue;
    const c = model.counts;
    const summary =
      `OK: ${c.entities} entities, ${c.relationships} relationships, ` +
      `${c.subtypes} subtype clusters, ${c.subjectAreas} subject areas, ` +
      `${c.layouts} layouts, ${c.words} words, ${c.terms} terms, ${c.domains} domains`;
    ok.push(model.dir === '' ? summary : `${model.dir}: ${summary}`);
  }
  for (const line of ok) out(line);
  if (errors > 0) {
    err('');
    err(`${errors} error(s)`);
    return 1;
  }
  return 0;
}
