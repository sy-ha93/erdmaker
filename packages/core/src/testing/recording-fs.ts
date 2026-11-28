import type { FileEntry, FileSystemAdapter } from '../fs/adapter.js';
import { createMemoryFileSystem } from '../fs/memory.js';
import { joinPath, normalizePath } from '../fs/path.js';

/** One adapter call, in the order made. Failed calls are recorded too. */
export interface AdapterCall {
  op: 'readText' | 'writeText' | 'list' | 'remove';
  path: string;
}

/** The switches of a recording adapter. Each holds normalized paths. */
export interface Faults {
  /** Folders whose `list` rejects with `EACCES`. */
  list: Set<string>;
  /** Paths whose `readText` rejects with `EACCES`. */
  read: Set<string>;
  /** Paths whose `writeText` rejects with `EACCES`. */
  write: Set<string>;
  /** Paths that read as files but are left out of their parent's listing. */
  unlisted: Set<string>;
}

export interface RecordingFileSystem extends FileSystemAdapter {
  /** The calls since it was made or last cleared. */
  readonly calls: readonly AdapterCall[];
  /** The calls of one kind, as paths. */
  paths(op: AdapterCall['op']): string[];
  clear(): void;
  readonly faults: Faults;
}

/** An error as the Node adapter passes on a permission failure. */
export function accessError(op: string, path: string): Error {
  return Object.assign(
    new Error(`EACCES: permission denied, ${op} '${path}'`),
    { code: 'EACCES' },
  );
}

/**
 * `inner` with every call recorded before it is made, and with faults that
 * can be switched on per path. Default: a memory adapter over `files`.
 */
export function recordingFileSystem(
  files: Readonly<Record<string, string>> = {},
  inner: FileSystemAdapter = createMemoryFileSystem(files),
): RecordingFileSystem {
  const calls: AdapterCall[] = [];
  const faults: Faults = {
    list: new Set(),
    read: new Set(),
    write: new Set(),
    unlisted: new Set(),
  };
  return {
    calls,
    faults,
    paths: (op) => calls.filter((call) => call.op === op).map((c) => c.path),
    clear() {
      calls.length = 0;
    },
    async readText(path) {
      calls.push({ op: 'readText', path });
      if (faults.read.has(normalizePath(path))) {
        throw accessError('open', path);
      }
      return inner.readText(path);
    },
    async writeText(path, text) {
      calls.push({ op: 'writeText', path });
      if (faults.write.has(normalizePath(path))) {
        throw accessError('open', path);
      }
      return inner.writeText(path, text);
    },
    async list(dir) {
      calls.push({ op: 'list', path: dir });
      if (faults.list.has(normalizePath(dir))) {
        throw accessError('scandir', dir);
      }
      const entries: FileEntry[] = await inner.list(dir);
      return entries.filter(
        (entry) => !faults.unlisted.has(joinPath(dir, entry.name)),
      );
    },
    async remove(path) {
      calls.push({ op: 'remove', path });
      return inner.remove(path);
    },
  };
}
