export interface FileEntry {
  name: string;
  kind: 'file' | 'directory';
}

/**
 * File access for the core. Paths are relative to the opened folder, use `/`,
 * and may start with `..`. The opened folder itself is `""`.
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

export class FileNotFoundError extends Error {
  readonly path: string;

  constructor(path: string, options?: { cause?: unknown }) {
    super(`File not found: ${path}`, options);
    this.name = 'FileNotFoundError';
    this.path = path;
  }
}
