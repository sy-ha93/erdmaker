import { stat } from 'node:fs/promises';
import { type Issue, validateProject } from '@erdmaker/core';
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
 * error (warnings do not count), 1 when there is an error, 2 for a usage
 * error (no or unknown command, `dir` not a folder, no model found).
 */
export async function main(
  args: readonly string[],
  output: Output = processOutput,
): Promise<number> {
  const [command, dir, ...rest] = args;
  if (command !== undefined && command !== 'validate') {
    output.err(`Unknown command: ${command}`);
    output.err(USAGE);
    return 2;
  }
  if (dir === undefined || rest.length > 0) {
    output.err(USAGE);
    return 2;
  }
  if (!(await isFolder(dir))) {
    output.err(`Not a folder: ${dir}`);
    return 2;
  }
  const project = await validateProject(createNodeFileSystem(dir), '');
  if (project.models.length === 0) {
    output.err(`No model found in ${dir}`);
    return 2;
  }

  let errors = 0;
  const report = (issue: Issue) => {
    if (issue.severity === 'error') errors += 1;
    output.err(issueLine(issue));
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
  for (const line of ok) output.out(line);
  if (errors > 0) {
    output.err('');
    output.err(`${errors} error(s)`);
    return 1;
  }
  return 0;
}
