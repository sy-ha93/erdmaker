import type { Issue, PositionIndex } from '../model/types.js';

/** Position indexes by file, as `loadModel` returns them. */
export type FilePositions = ReadonlyMap<string, PositionIndex>;

/**
 * Gives an issue its line and column: (1) a position the parser or a comment
 * gave stays; (2) otherwise `path` is looked up in the file's index; (3) the
 * whole file `""` of an indexed file is 1:1. Without an index for the file, or
 * a path missing from it, the issue has no position.
 */
export function placeIssue(issue: Issue, positions?: FilePositions): Issue {
  if (issue.line !== undefined && issue.column !== undefined) return issue;
  const { rule, severity, file, path, message } = issue;
  const rest: Issue = { rule, severity, file, path, message };
  const index = positions?.get(issue.file);
  if (!index) return rest;
  const at =
    index.get(issue.path) ??
    (issue.path === '' ? { line: 1, column: 1 } : undefined);
  return at ? { ...rest, line: at.line, column: at.column } : rest;
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** By file, issues without a position first, line, column, rule, message; text by code unit. */
export function compareIssues(a: Issue, b: Issue): number {
  return (
    compareText(a.file, b.file) ||
    Number(a.line !== undefined) - Number(b.line !== undefined) ||
    (a.line ?? 0) - (b.line ?? 0) ||
    (a.column ?? 0) - (b.column ?? 0) ||
    compareText(a.rule, b.rule) ||
    compareText(a.message, b.message)
  );
}

/** Placed and sorted copies; the input is not changed. */
export function finishIssues(
  issues: readonly Issue[],
  positions?: FilePositions,
): Issue[] {
  return issues
    .map((issue) => placeIssue(issue, positions))
    .sort(compareIssues);
}
