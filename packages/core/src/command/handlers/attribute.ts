import type { HandlerResult } from '../find.js';
import type {
  AttributeCreateCommand,
  AttributeDeleteCommand,
  AttributeMoveCommand,
  AttributeUpdateCommand,
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

/** The fields of `attribute.create` before its type, in the format's order. */
const LEADING = ['definition', 'note', 'scope', 'term', 'domain'] as const;

/** The fields after its type. */
const TRAILING = [
  'nullable',
  'default',
  'validValues',
  'physical',
  'nameSource',
  'ext',
] as const;

/** `set.domain` drops `type` and `set.type` drops `domain` (spec FR-07). */
const DROPS: ReadonlyMap<string, string> = new Map([
  ['domain', 'type'],
  ['type', 'domain'],
]);

/** `attribute.create`: at `before`, or at the end (spec appendix A, FR-05). */
export function createAttribute(
  command: AttributeCreateCommand,
  working: Working,
): HandlerResult {
  const owner = entityOf(working, command.entity);
  if (!owner.ok) return owner;
  const before = beforeOf(
    working,
    owner.entity,
    command.entity,
    'attributes',
    command.before,
  );
  if (!before.ok) return before;
  const id = memberId(
    working,
    owner.entity,
    command.entity,
    'attributes',
    command.id,
    {
      kind: 'attribute',
      name: command.name,
      physicalName: command.physical?.name,
    },
  );
  if (!id.ok) return id;
  const data: Fields = { id: id.id, name: command.name };
  copyFields(data, command, LEADING);
  // The command's `type` is its kind, so the attribute's type comes as `dataType`.
  if (command.dataType !== undefined) data.type = command.dataType;
  copyFields(data, command, TRAILING);
  working.insertMember(
    owner.entity,
    'attributes',
    data as { id: string },
    before.position,
  );
  return { ok: true, id: id.id };
}

/** `attribute.update`. */
export const updateAttribute = (
  command: AttributeUpdateCommand,
  working: Working,
): HandlerResult => updateMember(working, 'attributes', command, DROPS);

/** `attribute.delete`, out of the keys of its entity too (spec FR-07). */
export function deleteAttribute(
  command: AttributeDeleteCommand,
  working: Working,
): HandlerResult {
  const target = memberOf(working, 'attributes', command.entity, command.id);
  if (!target.ok) return target;
  working.removeMember(target.entity, 'attributes', target.position);
  working.removeFromKeys(target.entity, command.id);
  return { ok: true };
}

/** `attribute.move`. */
export const moveAttribute = (
  command: AttributeMoveCommand,
  working: Working,
): HandlerResult => moveMember(working, 'attributes', command);
