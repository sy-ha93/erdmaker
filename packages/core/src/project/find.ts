import { compareCodeUnits } from '../compare.js';
import type { FileSystemAdapter } from '../fs/adapter.js';
import { joinPath } from '../fs/path.js';
import type { Issue } from '../model/types.js';
import { finishIssues } from '../validate/issues.js';

/** The deepest folder searched for `model.yaml`; the opened folder is depth 0. */
export const MAX_MODEL_DEPTH = 3;

const MANIFEST = 'model.yaml';

export interface FoundModels {
  /** The folders holding a `model.yaml`, relative to the opened folder, in path order (code units). */
  models: string[];
  /** `P02`: a `model.yaml` inside a model folder, at that file. Sorted. */
  issues: Issue[];
}

/** Folders the search does not enter. */
const skipped = (name: string) =>
  name.startsWith('.') || name === 'node_modules';

/**
 * Finds the models in `dir` (relative to the adapter's folder): every folder
 * down to `MAX_MODEL_DEPTH` below `dir` that holds a `model.yaml`, without
 * entering folders whose names start with `.` or `node_modules`. A
 * `model.yaml` inside a model folder does not make another model: it is a
 * `P02` error at that file (line 1, column 1, the whole file). Each folder is
 * listed once, with an explicit stack; symbolic links are never listed (see
 * `FileSystemAdapter.list`). The adapter's failures reject.
 */
export async function findModels(
  fs: FileSystemAdapter,
  dir: string,
): Promise<FoundModels> {
  const models: string[] = [];
  const issues: Issue[] = [];
  const pending: { path: string; depth: number; model?: string }[] = [
    { path: joinPath(dir), depth: 0 },
  ];
  for (let next = pending.pop(); next; next = pending.pop()) {
    const entries = await fs.list(next.path);
    let model = next.model;
    if (entries.some((e) => e.kind === 'file' && e.name === MANIFEST)) {
      if (model === undefined) {
        models.push(next.path);
        model = next.path;
      } else {
        issues.push({
          rule: 'P02',
          severity: 'error',
          file: joinPath(next.path, MANIFEST),
          path: '',
          line: 1,
          column: 1,
          message: `${MANIFEST} inside another model (${joinPath(model, MANIFEST)})`,
        });
      }
    }
    if (next.depth === MAX_MODEL_DEPTH) continue;
    for (const entry of entries) {
      if (entry.kind !== 'directory' || skipped(entry.name)) continue;
      pending.push({
        path: joinPath(next.path, entry.name),
        depth: next.depth + 1,
        ...(model === undefined ? {} : { model }),
      });
    }
  }
  return {
    models: models.sort(compareCodeUnits),
    issues: finishIssues(issues),
  };
}
