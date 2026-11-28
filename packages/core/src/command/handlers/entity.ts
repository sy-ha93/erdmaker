import type { EntityData } from '../../model/types.js';
import { findEntity, findSubjectArea, type HandlerResult } from '../find.js';
import { chooseId, idBase, idProblem } from '../ids.js';
import type {
  EntityCreateCommand,
  EntityDeleteCommand,
  EntityUpdateCommand,
} from '../types.js';
import type { Working } from '../working.js';

/** The fields of `entity.create` an entity keeps, in the format's order. */
const CREATE_FIELDS = [
  'definition',
  'note',
  'scope',
  'nameSource',
  'physical',
] as const;

type Fields = Record<string, unknown>;

const idTaken = (message: string): HandlerResult => ({
  ok: false,
  code: 'id-taken',
  message,
});

/** `entity.create` (spec appendix A, FR-05, FR-07). */
export function createEntity(
  command: EntityCreateCommand,
  working: Working,
): HandlerResult {
  let area: number | undefined;
  if (command.subjectArea !== undefined) {
    const found = findSubjectArea(working, command.subjectArea);
    if (!found.ok) return found;
    area = found.position;
  }
  const space = working.entitySpace();
  let id: string;
  if (command.id !== undefined) {
    const problem = idProblem(space, command.id);
    if (problem !== undefined) return idTaken(problem);
    id = command.id;
  } else {
    const base = idBase({
      kind: 'entity',
      name: command.name,
      physicalName: command.physical?.name,
    });
    const choice = chooseId(space, base, command.physical);
    if (!choice.ok) return idTaken(choice.message);
    id = choice.id;
  }
  const data: Fields = { id, name: command.name };
  for (const field of CREATE_FIELDS) {
    if (command[field] !== undefined) data[field] = command[field];
  }
  data.attributes = [];
  if (command.ext !== undefined) data.ext = command.ext;
  working.append('entities', {
    file: working.newFile('entities', id),
    data: data as unknown as EntityData,
  });
  if (area !== undefined) working.addToArea(area, id);
  return { ok: true, id };
}

/** `entity.update`: `unset` first, then `set` (spec FR-07). */
export function updateEntity(
  command: EntityUpdateCommand,
  working: Working,
): HandlerResult {
  const found = findEntity(working, command.id);
  if (!found.ok) return found;
  const data = working.own<EntityData>('entities', found.position);
  const fields = data as unknown as Fields;
  let emptied = false;
  for (const name of command.unset ?? []) {
    if (name === 'physical.name' || name === 'physical.schema') {
      const key = name === 'physical.name' ? 'name' : 'schema';
      if (data.physical && Object.hasOwn(data.physical, key)) {
        delete data.physical[key];
        emptied = true;
      }
    } else {
      delete fields[name];
    }
  }
  const set = (command.set ?? {}) as Fields;
  for (const key of Object.keys(set)) {
    const value = set[key];
    if (key === 'physical') {
      const physical = value as Fields;
      if (Object.keys(physical).length === 0) continue;
      data.physical = { ...data.physical, ...physical };
    } else {
      fields[key] = value;
    }
  }
  // Only a key the command removed empties `physical`; `physical: {}` it
  // did not touch stays.
  if (emptied && data.physical && Object.keys(data.physical).length === 0) {
    delete data.physical;
  }
  return { ok: true };
}

/** `entity.delete`, out of its subject areas and layouts too (spec FR-07). */
export function deleteEntity(
  command: EntityDeleteCommand,
  working: Working,
): HandlerResult {
  const found = findEntity(working, command.id);
  if (!found.ok) return found;
  working.remove('entities', found.position);
  working.removeFromAreas(command.id);
  working.removeNodes(command.id);
  return { ok: true };
}
