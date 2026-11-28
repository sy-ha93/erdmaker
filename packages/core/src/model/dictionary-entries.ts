import { isAbsoluteEntry } from '../validate/manifest.js';
import { field, ownStrings } from '../validate/plain.js';
import { itemIssues } from '../validate/schema.js';

/** The folder read when the manifest names none, or is left out. */
const DEFAULT_FOLDER = 'dictionary';

/**
 * The dictionary folders, relative to the model folder, that `loadModel`
 * reads for a manifest's data (F02 FR-05) and an editor keeps new files out
 * of (F03 FR-06): one rule for both. `undefined` is no manifest. Data with
 * an error of its own (`itemIssues` against the `model` schema: what makes
 * `loadModel` leave a `model.yaml` out) is as no manifest. Then the data's
 * `dictionaries`, or `dictionary` when it has none, in order, absolute
 * entries left out. Reads own data properties only, through descriptors
 * (never a getter), and never throws.
 */
export function dictionaryEntries(data: unknown): string[] {
  if (data === undefined) return [DEFAULT_FOLDER];
  if (itemIssues('model.yaml', 'model', data).length > 0) {
    return [DEFAULT_FOLDER];
  }
  const named = field(data, 'dictionaries');
  const entries = named === undefined ? [DEFAULT_FOLDER] : ownStrings(named);
  // Data that read as valid but not as a list now (a lying object).
  if (entries === undefined) return [DEFAULT_FOLDER];
  return entries.filter((entry) => !isAbsoluteEntry(entry));
}
