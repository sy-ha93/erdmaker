import type { SubjectAreaData } from '../../model/types.js';
import { findSubjectArea, type HandlerResult } from '../find.js';
import { chooseId, idBase, idProblem } from '../ids.js';
import type {
  SubjectAreaAddEntitiesCommand,
  SubjectAreaCreateCommand,
  SubjectAreaDeleteCommand,
  SubjectAreaRemoveEntitiesCommand,
  SubjectAreaUpdateCommand,
} from '../types.js';
import type { Working } from '../working.js';
import { copyFields } from './members.js';
import { applyUpdate, type Fields } from './update.js';

/** The fields of `subjectArea.create` after `name`, before `entities`. */
const FIELDS = ['definition', 'group', 'order'] as const;

const idTaken = (message: string): HandlerResult => ({
  ok: false,
  code: 'id-taken',
  message,
});

/** `subjectArea.create`: `entities` is `[]` when absent (spec appendix A). */
export function createSubjectArea(
  command: SubjectAreaCreateCommand,
  working: Working,
): HandlerResult {
  const space = working.subjectAreaSpace();
  let id: string;
  if (command.id !== undefined) {
    const problem = idProblem(space, command.id);
    if (problem !== undefined) return idTaken(problem);
    id = command.id;
  } else {
    const choice = chooseId(
      space,
      idBase({ kind: 'subject area', name: command.name }),
    );
    if (!choice.ok) return idTaken(choice.message);
    id = choice.id;
  }
  const data: Fields = { id, name: command.name };
  copyFields(data, command, FIELDS);
  // The command's own copy: no one else holds it.
  data.entities = command.entities ?? [];
  if (command.ext !== undefined) data.ext = command.ext;
  working.append('subjectAreas', {
    file: working.newFile('subject-areas', id),
    data: data as unknown as SubjectAreaData,
  });
  return { ok: true, id };
}

/** `subjectArea.update`. */
export function updateSubjectArea(
  command: SubjectAreaUpdateCommand,
  working: Working,
): HandlerResult {
  const found = findSubjectArea(working, command.id);
  if (!found.ok) return found;
  const data = working.ownSubjectArea(found.position);
  applyUpdate(data as unknown as Fields, command.set, command.unset);
  return { ok: true };
}

/** `subjectArea.delete`, with every layout of the area (spec FR-07). */
export function deleteSubjectArea(
  command: SubjectAreaDeleteCommand,
  working: Working,
): HandlerResult {
  const found = findSubjectArea(working, command.id);
  if (!found.ok) return found;
  working.remove('subjectAreas', found.position);
  working.removeLayoutsOf(command.id);
  return { ok: true };
}

/** `subjectArea.addEntities`: those not there yet, in the order given. */
export function addEntities(
  command: SubjectAreaAddEntitiesCommand,
  working: Working,
): HandlerResult {
  const found = findSubjectArea(working, command.id);
  if (!found.ok) return found;
  // work-ok: the ids the command names; each one a few cells (addToArea)
  for (const entity of command.entities) {
    working.addToArea(found.position, entity);
  }
  return { ok: true };
}

/**
 * `subjectArea.removeEntities`: ids the area lacks are ignored; the nodes of
 * the given ids leave the layouts of the area (spec FR-07).
 */
export function removeEntities(
  command: SubjectAreaRemoveEntitiesCommand,
  working: Working,
): HandlerResult {
  const found = findSubjectArea(working, command.id);
  if (!found.ok) return found;
  working.removeFromArea(found.position, command.entities);
  working.removeAreaNodes(command.id, command.entities);
  return { ok: true };
}
