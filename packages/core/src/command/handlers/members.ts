import { findEntity, findMember, type HandlerResult } from '../find.js';
import { chooseId, idBase, idProblem } from '../ids.js';
import type { Member, Working } from '../working.js';
import { applyUpdate, type Fields } from './update.js';

/** Where a member command acts: its entity, and the member it names. */
export type Target =
  | { ok: true; entity: number; position: number }
  | Exclude<HandlerResult, { ok: true }>;

/** The entity of a member command (spec FR-07, "대상 찾기"). */
export function entityOf(
  working: Working,
  entity: string,
): { ok: true; entity: number } | Exclude<HandlerResult, { ok: true }> {
  const found = findEntity(working, entity);
  return found.ok ? { ok: true, entity: found.position } : found;
}

/** The entity, then the member `id` in it. */
export function memberOf(
  working: Working,
  member: Member,
  entity: string,
  id: string,
): Target {
  const owner = entityOf(working, entity);
  if (!owner.ok) return owner;
  const found = findMember(working, owner.entity, entity, member, id);
  return found.ok
    ? { ok: true, entity: owner.entity, position: found.position }
    : found;
}

/** The position of `before` in the entity, when the command names one. */
export function beforeOf(
  working: Working,
  owner: number,
  entity: string,
  member: Member,
  before: string | undefined,
): { ok: true; position?: number } | Exclude<HandlerResult, { ok: true }> {
  if (before === undefined) return { ok: true };
  const found = findMember(working, owner, entity, member, before);
  return found.ok ? { ok: true, position: found.position } : found;
}

/** The id a member create uses: the given one if it can be used, else a generated one. */
export function memberId(
  working: Working,
  owner: number,
  entity: string,
  member: Member,
  given: string | undefined,
  base: Parameters<typeof idBase>[0],
): { ok: true; id: string } | Exclude<HandlerResult, { ok: true }> {
  const space = working.memberSpace(owner, member, entity);
  if (given !== undefined) {
    const problem = idProblem(space, given);
    return problem === undefined
      ? { ok: true, id: given }
      : { ok: false, code: 'id-taken', message: problem };
  }
  const choice = chooseId(space, idBase(base));
  return choice.ok
    ? choice
    : { ok: false, code: 'id-taken', message: choice.message };
}

/** `*.update` of an attribute or a key. */
export function updateMember(
  working: Working,
  member: Member,
  command: {
    entity: string;
    id: string;
    set?: object;
    unset?: readonly string[];
  },
  drops?: ReadonlyMap<string, string>,
): HandlerResult {
  const target = memberOf(working, member, command.entity, command.id);
  if (!target.ok) return target;
  const data = working.ownMember<Fields>(
    target.entity,
    member,
    target.position,
  );
  applyUpdate(data, command.set, command.unset, drops);
  return { ok: true };
}

/** `*.move` of an attribute or a key (spec FR-07, "순서"). */
export function moveMember(
  working: Working,
  member: Member,
  command: { entity: string; id: string; before?: string },
): HandlerResult {
  const target = memberOf(working, member, command.entity, command.id);
  if (!target.ok) return target;
  const before = beforeOf(
    working,
    target.entity,
    command.entity,
    member,
    command.before,
  );
  if (!before.ok) return before;
  // Before itself: nothing moves.
  if (command.before === command.id) return { ok: true };
  working.moveMember(target.entity, member, target.position, before.position);
  return { ok: true };
}

/** Puts the fields of `command` named in `fields` into `data`, in that order. */
export function copyFields(
  data: Fields,
  command: object,
  fields: readonly string[],
): void {
  const from = command as Fields;
  // work-ok: the field names of one command kind
  for (const field of fields) {
    if (from[field] !== undefined) data[field] = from[field];
  }
}
