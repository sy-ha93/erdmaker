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

const USAGE = 'Usage: erdmaker validate <dir>';

/**
 * C0 controls, DEL, C1 controls, the Unicode line and paragraph separators,
 * the bidirectional embedding, override and isolate controls, and (with the
 * `u` flag a pair is one character) lone surrogates.
 */
const LINE_BREAKING =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069\ud800-\udfff]/gu;
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

/** The most code points of a message the CLI prints (spec FR-11). */
export const MAX_MESSAGE = 500;

/**
 * An error's message, or the value as a string, cut to `MAX_MESSAGE` code
 * points with `…` after it when longer; never throws.
 */
export function describeError(error: unknown): string {
  let text: string;
  try {
    text = error instanceof Error ? String(error.message) : String(error);
  } catch {
    return 'unknown error';
  }
  let count = 0;
  for (let index = 0; index < text.length; count += 1) {
    if (count === MAX_MESSAGE) return `${text.slice(0, index)}…`;
    index += text.codePointAt(index)! > 0xffff ? 2 : 1;
  }
  return text;
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

/** Why `path` cannot be opened as a folder, or `undefined` when it can. */
async function folderProblem(path: string): Promise<string | undefined> {
  try {
    return (await stat(path)).isDirectory()
      ? undefined
      : `Not a folder: ${path}`;
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return code === 'ENOENT' || code === 'ENOTDIR'
      ? `Not a folder: ${path}`
      : `Cannot read ${path}: ${describeError(error)}`;
  }
}

/**
 * `erdmaker validate <dir>`: checks the models in `dir`, a model folder or a
 * project folder (spec FR-11). Returns the exit code: 0 when no model has an
 * error (warnings do not count), 1 when a model has an error, 2 when the
 * check could not run: a usage error (no or unknown command), `dir` not a
 * folder, no model found, or a failure to read the folder (`stat` of `dir`
 * failed other than with `ENOENT` or `ENOTDIR`, or the adapter rejected,
 * e.g. `EACCES`; reported as `Cannot read <dir>: <message>`, with nothing on
 * stdout). Every line written is escaped by `oneLine`, so one
 * record is one line. `open` makes the adapter over `dir`.
 */
export async function main(
  args: readonly string[],
  output: Output,
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
  const problem = await folderProblem(dir);
  if (problem !== undefined) {
    err(problem);
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

/** What `cli` writes to and how it ends the process; `process` is one. */
export interface Stdio {
  readonly stdout: NodeJS.WritableStream;
  readonly stderr: NodeJS.WritableStream;
  exitCode?: number | string | null | undefined;
  exit(code: number): void;
}

/**
 * Runs `main` on the process's streams (spec FR-11). Listens for stream
 * errors before `main` starts. `EPIPE` (the reader closed the pipe, as
 * `| head -1` does) stops all writing and exits quietly with `main`'s exit
 * code, or 2 while `main` has not returned yet. Any other stream error
 * stops all writing, prints `Unexpected error: <message>` on stderr unless
 * stderr failed, and exits 2. An exception out of `main` is that same line
 * and 2. Nothing prints a stack.
 */
export async function cli(
  args: readonly string[],
  stdio: Stdio = process,
): Promise<void> {
  let code: number | undefined;
  let stopped = false;
  const unexpected = (error: unknown) =>
    `${oneLine(`Unexpected error: ${describeError(error)}`)}\n`;
  const onError = (failed: 'stdout' | 'stderr') => (error: unknown) => {
    if (stopped) return;
    stopped = true;
    if ((error as { code?: unknown } | null)?.code === 'EPIPE') {
      stdio.exit(code ?? 2);
      return;
    }
    if (failed === 'stdout') stdio.stderr.write(unexpected(error));
    stdio.exit(2);
  };
  stdio.stdout.on('error', onError('stdout'));
  stdio.stderr.on('error', onError('stderr'));
  const output: Output = {
    out: (line) => void (stopped || stdio.stdout.write(`${line}\n`)),
    err: (line) => void (stopped || stdio.stderr.write(`${line}\n`)),
  };
  try {
    code = await main(args, output);
  } catch (error) {
    if (!stopped) stdio.stderr.write(unexpected(error));
    code = 2;
  }
  if (!stopped) stdio.exitCode = code;
}
