import type { Issue } from '../model/types.js';
import { field, indexed } from './plain.js';

export const ABSOLUTE_MESSAGE = 'dictionaries entries must be relative paths';

/** A path from the root of a file system, POSIX or Windows. */
const ABSOLUTE = /^(?:[/\\]|[A-Za-z]:[/\\])/;

/** Whether a `dictionaries` entry of `model.yaml` is an absolute path. */
export function isAbsoluteEntry(entry: string): boolean {
  return ABSOLUTE.test(entry);
}

/**
 * A `schema` error at `/dictionaries/<i>` for each absolute entry of the
 * manifest `data`, which the schema allows but the format does not. Reads
 * `data` as plain data without calling getters, and never throws.
 */
export function manifestIssues(file: string, data: unknown): Issue[] {
  const issues: Issue[] = [];
  for (const [i, entry] of indexed(field(data, 'dictionaries'))) {
    if (typeof entry === 'string' && isAbsoluteEntry(entry)) {
      issues.push({
        rule: 'schema',
        severity: 'error',
        file,
        path: `/dictionaries/${i}`,
        message: ABSOLUTE_MESSAGE,
      });
    }
  }
  return issues;
}
