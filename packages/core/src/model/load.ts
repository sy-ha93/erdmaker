import { compareCodeUnits } from '../compare.js';
import { FileNotFoundError, type FileSystemAdapter } from '../fs/adapter.js';
import { joinPath } from '../fs/path.js';
import { parseJson } from '../parse/json.js';
import { parseYaml } from '../parse/yaml.js';
import type { SchemaName } from '../schema/ajv.js';
import { type FilePositions, finishIssues } from '../validate/issues.js';
import { isAbsoluteEntry } from '../validate/manifest.js';
import { itemIssues } from '../validate/schema.js';
import type {
  DictionaryData,
  EntityData,
  Issue,
  LayoutData,
  ManifestData,
  Model,
  ModelItem,
  PositionIndex,
  RelationshipData,
  SubjectAreaData,
  SubtypeData,
} from './types.js';

export const COMMENT_MESSAGE =
  'YAML comments are not kept when erdmaker rewrites this file';

export interface LoadResult {
  model: Model;
  /**
   * Errors of the files left out of the model and a `comment` warning per
   * file in the model that has comments. Sorted. An absolute `dictionaries`
   * entry is not read but `model.yaml` stays in the model, so its error comes
   * from `validateModel`, not from here.
   */
  issues: Issue[];
  /** Each model file's position index, by file. */
  positions: FilePositions;
}

const byName = (a: { name: string }, b: { name: string }) =>
  compareCodeUnits(a.name, b.name);

/**
 * The files under `dir` whose names end with `extension`, subfolders
 * included: each folder's entries by name (code units), a folder's files
 * where its name sorts. Walks with an explicit stack, so any depth fits.
 * A folder in `walked` (normalized paths) is left out with what it holds,
 * and each folder listed is added to it.
 */
async function filesUnder(
  fs: FileSystemAdapter,
  dir: string,
  extension: string,
  walked = new Set<string>(),
): Promise<string[]> {
  const found: string[] = [];
  const pending: { path: string; folder: boolean }[] = [
    { path: dir, folder: true },
  ];
  for (let next = pending.pop(); next; next = pending.pop()) {
    if (!next.folder) {
      found.push(next.path);
      continue;
    }
    if (walked.has(next.path)) continue;
    walked.add(next.path);
    const entries = (await fs.list(next.path)).sort(byName);
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (!entry) continue;
      const path = joinPath(next.path, entry.name);
      if (entry.kind === 'directory') pending.push({ path, folder: true });
      else if (entry.name.endsWith(extension)) {
        pending.push({ path, folder: false });
      }
    }
  }
  return found;
}

/**
 * Reads the model in `modelDir` (relative to the adapter's folder) as the old
 * tool did: `model.yaml`, the YAML files under `entities/`, `relationships/`,
 * `subtypes/` and `subject-areas/`, the JSON files under `layouts/`, and the
 * YAML files of each dictionary folder `model.yaml` names (`dictionary` when
 * it names none or cannot be read), each file once in the order first found;
 * an absolute folder is not read (`validateModel` reports it). A file with syntax, YAML
 * feature or schema errors is left out and its errors are returned; the other
 * files are still read. A listed file that reads as not found (gone since
 * it was listed, or a path the system refuses) is left out quietly, as if
 * it had not been listed. The adapter's other failures, a missing
 * `model.yaml` included, reject.
 */
export async function loadModel(
  fs: FileSystemAdapter,
  modelDir: string,
): Promise<LoadResult> {
  const dir = joinPath(modelDir);
  const issues: Issue[] = [];
  const positions = new Map<string, PositionIndex>();

  const parse = <T>(
    file: string,
    schema: SchemaName,
    text: string,
  ): ModelItem<T> | undefined => {
    const parsed =
      schema === 'layout' ? parseJson(file, text) : parseYaml(file, text);
    if (parsed.issues.length > 0) {
      for (const issue of parsed.issues) issues.push(issue);
      return undefined;
    }
    const found = itemIssues(file, schema, parsed.value);
    if (found.length > 0) {
      const index = new Map([[file, parsed.positions]]);
      for (const issue of finishIssues(found, index)) issues.push(issue);
      return undefined;
    }
    positions.set(file, parsed.positions);
    if (parsed.firstComment) {
      issues.push({
        rule: 'comment',
        severity: 'warning',
        file,
        path: '',
        line: parsed.firstComment.line,
        column: parsed.firstComment.column,
        message: COMMENT_MESSAGE,
      });
    }
    return { file, data: parsed.value as T };
  };

  /** A file `list` gave, read and parsed; one not found by now is left out. */
  const read = async <T>(
    file: string,
    schema: SchemaName,
  ): Promise<ModelItem<T> | undefined> => {
    let text: string;
    try {
      text = await fs.readText(file);
    } catch (error) {
      if (error instanceof FileNotFoundError) return undefined;
      throw error;
    }
    return parse<T>(file, schema, text);
  };

  const readAll = async <T>(
    folder: string,
    extension: string,
    schema: SchemaName,
  ): Promise<ModelItem<T>[]> => {
    const items: ModelItem<T>[] = [];
    for (const file of await filesUnder(fs, folder, extension)) {
      const item = await read<T>(file, schema);
      if (item) items.push(item);
    }
    return items;
  };

  // Not listed: a missing `model.yaml` rejects.
  const manifestFile = joinPath(dir, 'model.yaml');
  const manifest = parse<ManifestData>(
    manifestFile,
    'model',
    await fs.readText(manifestFile),
  );
  // Each dictionary file once, where its first listed folder finds it, so
  // folders that are the same or nest give one item and one warning per file.
  // Each folder is listed once too: a folder named again (`a/../dictionary`)
  // or inside one walked already is not walked again.
  const dictionaryFiles = new Set<string>();
  const walked = new Set<string>();
  const folders = manifest?.data.dictionaries ?? ['dictionary'];
  for (const folder of folders) {
    if (isAbsoluteEntry(folder)) continue;
    const under = await filesUnder(fs, joinPath(dir, folder), '.yaml', walked);
    for (const file of under) dictionaryFiles.add(file);
  }
  const dictionaries: ModelItem<DictionaryData>[] = [];
  for (const file of dictionaryFiles) {
    const item = await read<DictionaryData>(file, 'dictionary');
    if (item) dictionaries.push(item);
  }
  const model: Model = {
    dir,
    ...(manifest ? { manifest } : {}),
    entities: await readAll<EntityData>(
      joinPath(dir, 'entities'),
      '.yaml',
      'entity',
    ),
    relationships: await readAll<RelationshipData>(
      joinPath(dir, 'relationships'),
      '.yaml',
      'relationship',
    ),
    subtypes: await readAll<SubtypeData>(
      joinPath(dir, 'subtypes'),
      '.yaml',
      'subtype',
    ),
    subjectAreas: await readAll<SubjectAreaData>(
      joinPath(dir, 'subject-areas'),
      '.yaml',
      'subject-area',
    ),
    layouts: await readAll<LayoutData>(
      joinPath(dir, 'layouts'),
      '.json',
      'layout',
    ),
    dictionaries,
  };
  return { model, issues: finishIssues(issues), positions };
}
