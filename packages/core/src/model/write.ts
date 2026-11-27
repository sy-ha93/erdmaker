import { FileNotFoundError, type FileSystemAdapter } from '../fs/adapter.js';
import { serializeModel } from './serialize.js';
import type { Model } from './types.js';

/**
 * Writes the files of `serializeModel(model)` whose text differs from the
 * file there, or that are not there yet (spec FR-06), and returns their
 * paths in code unit order. Files the model does not hold, such as those
 * left out on reading, are not touched, and nothing is removed.
 *
 * Rejects without writing anything when `serializeModel` throws (data that
 * is not JSON data, for one) or when reading a file fails other than with
 * `FileNotFoundError`: every file is read before the first write. A failure
 * of the adapter while writing can leave the files before it written.
 */
export async function writeModel(
  fs: FileSystemAdapter,
  model: Model,
): Promise<string[]> {
  const changed = [];
  for (const file of serializeModel(model)) {
    let current: string | undefined;
    try {
      current = await fs.readText(file.file);
    } catch (error) {
      if (!(error instanceof FileNotFoundError)) throw error;
    }
    if (current !== file.text) changed.push(file);
  }
  for (const { file, text } of changed) await fs.writeText(file, text);
  return changed.map(({ file }) => file);
}
