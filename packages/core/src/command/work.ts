/** What a working-state helper did with the cells of a list or an index. */
export type WorkKind = 'copy' | 'scan' | 'index-build';

/**
 * Where the working-state helpers report the cells they copied, scanned or
 * indexed (plan decision 9). Does nothing: a test replaces this module to
 * count the work of a batch, so a list copied once per sub-command shows
 * as quadratic work without timing anything.
 */
export function noteWork(kind: WorkKind, entries: number): void {
  void kind;
  void entries;
}
