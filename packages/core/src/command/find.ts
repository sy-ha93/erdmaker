import type { Working } from './working.js';

/** The failure of a lookup or of a handler (spec FR-07, appendix B). */
export interface Refusal {
  ok: false;
  code: 'not-found' | 'ambiguous-target' | 'id-taken';
  message: string;
}

export type Found = { ok: true; position: number } | Refusal;

/** What a handler gives back: the id a create made, or its refusal. */
export type HandlerResult = { ok: true; id?: string } | Refusal;

/** The one position of `positions`, or why there is not one. */
function only(
  positions: readonly number[],
  missing: string,
  shared: string,
): Found {
  if (positions.length === 0) {
    return { ok: false, code: 'not-found', message: missing };
  }
  if (positions.length > 1) {
    return { ok: false, code: 'ambiguous-target', message: shared };
  }
  return { ok: true, position: positions[0]! };
}

/** The entity with this id (spec FR-07, "대상 찾기"). */
export function findEntity(working: Working, id: string): Found {
  return only(
    working.positions('entities', id),
    `entity "${id}" does not exist`,
    `entity "${id}" is not unique in the model`,
  );
}

/** The subject area with this id. */
export function findSubjectArea(working: Working, id: string): Found {
  return only(
    working.positions('subjectAreas', id),
    `subject area "${id}" does not exist`,
    `subject area "${id}" is not unique in the model`,
  );
}
