export interface FileEntry {
  name: string;
  kind: 'file' | 'directory';
}

/**
 * File access for the core. Paths are relative to the opened folder, use `/`,
 * and may start with `..`. The opened folder itself is `""`. A leading `/`
 * is read as relative to the opened folder too: refusing absolute paths is
 * the calling code's part (spec 8).
 */
export interface FileSystemAdapter {
  /** Rejects with `FileNotFoundError` when the file does not exist. */
  readText(path: string): Promise<string>;
  /** Writes the text unchanged and creates missing parent folders. */
  writeText(path: string, text: string): Promise<void>;
  /** Entries directly under `dir`; an empty list when there is no such folder. */
  list(dir: string): Promise<FileEntry[]>;
  /** Removes a file; does nothing when it does not exist. */
  remove(path: string): Promise<void>;
}

/**
 * A file that is not there. `path` is the path as given; the message cuts
 * it to its first 200 characters and `…`, so a huge path makes a short one.
 */
export class FileNotFoundError extends Error {
  readonly path: string;

  constructor(path: string, options?: { cause?: unknown }) {
    const shown = path.length > 200 ? `${path.slice(0, 200)}…` : path;
    super(`File not found: ${shown}`, options);
    this.name = 'FileNotFoundError';
    this.path = path;
  }
}
