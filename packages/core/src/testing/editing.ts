import type { CommandResult } from '../command/types.js';
import { createMemoryFileSystem } from '../fs/memory.js';
import { loadModel } from '../model/load.js';
import type {
  EntityData,
  Model,
  ModelItem,
  SubjectAreaData,
} from '../model/types.js';
import { exampleFiles, type Files } from './example.js';

/** The manifest of the empty model (spec section 6, "빈 모델"). */
export const EMPTY_MANIFEST = 'formatVersion: "0.1"\nid: m\nname: M\n';

let example: Files | undefined;

/** The example's files, read from disk once per test file. */
export function cachedExampleFiles(): Files {
  example ??= exampleFiles();
  return { ...example };
}

/** The files of the empty model. */
export const emptyFiles = (): Files => ({ 'model.yaml': EMPTY_MANIFEST });

/** `files` loaded with `loadModel` from a fresh memory adapter. */
export async function loadFiles(files: Files, dir = ''): Promise<Model> {
  return (await loadModel(createMemoryFileSystem(files), dir)).model;
}

/** The example model, read fresh. */
export const exampleModel = (): Promise<Model> =>
  loadFiles(cachedExampleFiles());

/** The empty model, read fresh. */
export const emptyModel = (): Promise<Model> => loadFiles(emptyFiles());

/** A model built by hand, without a manifest unless given. */
export const handModel = (partial: Partial<Model> = {}): Model => ({
  dir: '',
  entities: [],
  relationships: [],
  subtypes: [],
  subjectAreas: [],
  layouts: [],
  dictionaries: [],
  ...partial,
});

/** An entity item at `entities/<id>.yaml` unless `file` is given. */
export const entityItem = (
  id: string,
  extra: Partial<EntityData> = {},
  file = `entities/${id}.yaml`,
): ModelItem<EntityData> => ({
  file,
  data: { id, name: id, attributes: [], ...extra },
});

/** A subject area item at `subject-areas/<id>.yaml`. */
export const areaItem = (
  id: string,
  entities: string[] = [],
): ModelItem<SubjectAreaData> => ({
  file: `subject-areas/${id}.yaml`,
  data: { id, name: id, entities },
});

/** The result when it is a success; throws with its message otherwise. */
export function succeeded(
  result: CommandResult,
): Extract<CommandResult, { ok: true }> {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
}
