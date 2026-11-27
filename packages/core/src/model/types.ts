export type Severity = 'error' | 'warning';

/** A place in a file. Both numbers count from 1. */
export interface Position {
  line: number;
  column: number;
}

/** JSON Pointer (RFC 6901) inside one file's data → where it starts in the file text. */
export type PositionIndex = ReadonlyMap<string, Position>;

export interface Issue {
  rule:
    | 'syntax'
    | 'yaml-feature'
    | 'schema'
    | 'R01'
    | 'R02'
    | 'R03'
    | 'R04'
    | 'R05'
    | 'R06'
    | 'R07'
    | 'R08'
    | 'R09'
    | 'R10'
    | 'R11'
    | 'R12'
    | 'P01'
    | 'P02'
    | 'comment';
  severity: Severity;
  /** Relative to the opened folder. */
  file: string;
  /** JSON Pointer inside the file's data; `""` is the whole file. */
  path: string;
  /** Absent when the file has no position index or the path is not in it. */
  line?: number;
  column?: number;
  message: string;
}
