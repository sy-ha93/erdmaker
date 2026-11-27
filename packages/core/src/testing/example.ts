import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compareCodeUnits } from '../compare.js';
import type { FileSystemAdapter } from '../fs/adapter.js';
import { createMemoryFileSystem } from '../fs/memory.js';

/** `format/v0/examples/shop` on disk. */
export const EXAMPLE_DIR = fileURLToPath(
  new URL('../../../../format/v0/examples/shop/', import.meta.url),
);

/** Model files as `path → text`, paths relative to the model folder. */
export type Files = Record<string, string>;

/** Every file of the example model, read from disk, in path order. */
export function exampleFiles(): Files {
  const files: Files = {};
  const pending = [''];
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    for (const entry of readdirSync(`${EXAMPLE_DIR}${dir}`, {
      withFileTypes: true,
    })) {
      const path = `${dir}${entry.name}`;
      if (entry.isDirectory()) pending.push(`${path}/`);
      else files[path] = readFileSync(`${EXAMPLE_DIR}${path}`, 'utf8');
    }
  }
  return Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => compareCodeUnits(a, b)),
  );
}

/**
 * A copy of `files` with the one occurrence of `search` in `file` replaced.
 * Throws when the file is missing or `search` occurs in it zero or several
 * times, so a case cannot silently stop changing the example.
 */
export function replaceOnce(
  files: Files,
  file: string,
  search: string,
  replacement: string,
): Files {
  const text = files[file];
  if (text === undefined) throw new Error(`No file ${file}`);
  const at = text.indexOf(search);
  if (at === -1) throw new Error(`${JSON.stringify(search)} is not in ${file}`);
  if (text.indexOf(search, at + 1) !== -1) {
    throw new Error(
      `${JSON.stringify(search)} occurs more than once in ${file}`,
    );
  }
  return {
    ...files,
    [file]: text.slice(0, at) + replacement + text.slice(at + search.length),
  };
}

/** A memory adapter whose opened folder holds `files`. */
export function exampleFileSystem(
  files: Files = exampleFiles(),
): FileSystemAdapter {
  return createMemoryFileSystem(files);
}
