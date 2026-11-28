import type { HandlerResult } from '../find.js';
import type {
  KeyCreateCommand,
  KeyDeleteCommand,
  KeyMoveCommand,
  KeyUpdateCommand,
} from '../types.js';
import type { Working } from '../working.js';
import {
  beforeOf,
  copyFields,
  entityOf,
  memberId,
  memberOf,
  moveMember,
  updateMember,
} from './members.js';
import type { Fields } from './update.js';

/** The fields of `key.create` after `kind`, in the format's order. */
const FIELDS = ['name', 'attributes', 'scope', 'physical', 'ext'] as const;

/** `key.create`: at `before`, or at the end; makes `keys` when there is none. */
export function createKey(
  command: KeyCreateCommand,
  working: Working,
): HandlerResult {
  const owner = entityOf(working, command.entity);
  if (!owner.ok) return owner;
  const before = beforeOf(
    working,
    owner.entity,
    command.entity,
    'keys',
    command.before,
  );
  if (!before.ok) return before;
  const id = memberId(
    working,
    owner.entity,
    command.entity,
    'keys',
    command.id,
    {
      kind: 'key',
      keyKind: command.kind,
      name: command.name,
      physicalName: command.physical?.name,
    },
  );
  if (!id.ok) return id;
  const data: Fields = { id: id.id, kind: command.kind };
  copyFields(data, command, FIELDS);
  working.insertMember(
    owner.entity,
    'keys',
    data as { id: string },
    before.position,
  );
  return { ok: true, id: id.id };
}

/** `key.update`. */
export const updateKey = (
  command: KeyUpdateCommand,
  working: Working,
): HandlerResult => updateMember(working, 'keys', command);

/** `key.delete`; `keys` goes with the last key (spec FR-07). */
export function deleteKey(
  command: KeyDeleteCommand,
  working: Working,
): HandlerResult {
  const target = memberOf(working, 'keys', command.entity, command.id);
  if (!target.ok) return target;
  working.removeMember(target.entity, 'keys', target.position);
  working.dropEmptyKeys(target.entity);
  return { ok: true };
}

/** `key.move`. */
export const moveKey = (
  command: KeyMoveCommand,
  working: Working,
): HandlerResult => moveMember(working, 'keys', command);
