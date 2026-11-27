/** Escapes one reference token of a JSON Pointer (RFC 6901). */
export function escapePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}
