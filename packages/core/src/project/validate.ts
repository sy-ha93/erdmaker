import type { FileSystemAdapter } from '../fs/adapter.js';
import { loadModel } from '../model/load.js';
import type { Issue, Model, PositionIndex } from '../model/types.js';
import { validateModel } from '../validate/index.js';
import { finishIssues } from '../validate/issues.js';
import { findModels } from './find.js';

/** What a model holds, as read: items in the model, and the dictionary entries of all its files. */
export interface ModelCounts {
  entities: number;
  relationships: number;
  /** Subtype clusters: one per subtype file. */
  subtypes: number;
  subjectAreas: number;
  layouts: number;
  words: number;
  terms: number;
  domains: number;
}

export interface ModelResult {
  /** The model folder, relative to the opened folder. */
  dir: string;
  /** The issues of `loadModel` and `validateModel` together, sorted. */
  issues: Issue[];
  counts: ModelCounts;
}

export interface ProjectResult {
  /** `P01` and `P02` only, sorted. Each is linked to its model by `file`. */
  issues: Issue[];
  /** In the order `findModels` found them. */
  models: ModelResult[];
}

const length = (list: unknown) => (Array.isArray(list) ? list.length : 0);

function countModel(model: Model): ModelCounts {
  const counts: ModelCounts = {
    entities: model.entities.length,
    relationships: model.relationships.length,
    subtypes: model.subtypes.length,
    subjectAreas: model.subjectAreas.length,
    layouts: model.layouts.length,
    words: 0,
    terms: 0,
    domains: 0,
  };
  for (const { data } of model.dictionaries) {
    counts.words += length(data.words);
    counts.terms += length(data.terms);
    counts.domains += length(data.domains);
  }
  return counts;
}

/** A model's `model.yaml` as read into the model. */
export interface ModelId {
  file: string;
  id: string;
}

/**
 * `P01` for every manifest whose `id` another manifest also has, at its
 * `/id`. The first of such manifests names the second; each later one names
 * the first, so the messages grow with the number of manifests, not its
 * square. Not placed: the caller gives positions.
 */
export function modelIdIssues(manifests: readonly ModelId[]): Issue[] {
  const first = new Map<string, ModelId>();
  const second = new Map<string, ModelId>();
  for (const manifest of manifests) {
    if (!first.has(manifest.id)) first.set(manifest.id, manifest);
    else if (!second.has(manifest.id)) second.set(manifest.id, manifest);
  }
  const issues: Issue[] = [];
  for (const manifest of manifests) {
    const next = second.get(manifest.id);
    const head = first.get(manifest.id);
    if (!next || !head) continue;
    const other = manifest === head ? next : head;
    issues.push({
      rule: 'P01',
      severity: 'error',
      file: manifest.file,
      path: '/id',
      message: `duplicate model id "${manifest.id}" (also in ${other.file})`,
    });
  }
  return issues;
}

/**
 * Finds the models in `dir` (`findModels`), reads and checks each
 * (`loadModel`, `validateModel`), and compares their ids (`P01`; a model
 * whose `model.yaml` could not be read is left out). A dictionary folder
 * several models name is read and reported for each of them. Every issue has
 * a line and a column. The adapter's failures reject.
 */
export async function validateProject(
  fs: FileSystemAdapter,
  dir: string,
): Promise<ProjectResult> {
  const found = await findModels(fs, dir);
  const models: ModelResult[] = [];
  const manifests: ModelId[] = [];
  const positions = new Map<string, PositionIndex>();
  for (const modelDir of found.models) {
    const loaded = await loadModel(fs, modelDir);
    models.push({
      dir: modelDir,
      issues: finishIssues([
        ...loaded.issues,
        ...validateModel(loaded.model, loaded.positions),
      ]),
      counts: countModel(loaded.model),
    });
    const manifest = loaded.model.manifest;
    if (manifest) {
      manifests.push({ file: manifest.file, id: manifest.data.id });
      const index = loaded.positions.get(manifest.file);
      if (index) positions.set(manifest.file, index);
    }
  }
  return {
    issues: finishIssues(
      [...found.issues, ...modelIdIssues(manifests)],
      positions,
    ),
    models,
  };
}
