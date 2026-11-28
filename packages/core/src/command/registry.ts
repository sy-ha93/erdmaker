import type { HandlerResult } from './find.js';
import {
  createAttribute,
  deleteAttribute,
  moveAttribute,
  updateAttribute,
} from './handlers/attribute.js';
import { createEntity, deleteEntity, updateEntity } from './handlers/entity.js';
import { createKey, deleteKey, moveKey, updateKey } from './handlers/key.js';
import {
  addEntities,
  createSubjectArea,
  deleteSubjectArea,
  removeEntities,
  updateSubjectArea,
} from './handlers/subject-area.js';
import type {
  AttributeCreateCommand,
  AttributeDeleteCommand,
  AttributeMoveCommand,
  AttributeUpdateCommand,
  EntityCreateCommand,
  EntityDeleteCommand,
  EntityUpdateCommand,
  KeyCreateCommand,
  KeyDeleteCommand,
  KeyMoveCommand,
  KeyUpdateCommand,
  SubCommand,
  SubjectAreaAddEntitiesCommand,
  SubjectAreaCreateCommand,
  SubjectAreaDeleteCommand,
  SubjectAreaRemoveEntitiesCommand,
  SubjectAreaUpdateCommand,
} from './types.js';
import type { Working } from './working.js';

/**
 * What applies one kind of command to a working state. The command has
 * passed its kind's schema; the handler finds its targets, makes its ids
 * and changes the state through the working-state helpers.
 */
export type Handler = (command: SubCommand, working: Working) => HandlerResult;

// Each kind is a schema (`schemas.ts`) and a handler here (spec FR-01). The
// handlers are called through their modules, so a test can replace one.
const HANDLERS: ReadonlyMap<string, Handler> = new Map<string, Handler>([
  ['entity.create', (c, w) => createEntity(c as EntityCreateCommand, w)],
  ['entity.update', (c, w) => updateEntity(c as EntityUpdateCommand, w)],
  ['entity.delete', (c, w) => deleteEntity(c as EntityDeleteCommand, w)],
  [
    'attribute.create',
    (c, w) => createAttribute(c as AttributeCreateCommand, w),
  ],
  [
    'attribute.update',
    (c, w) => updateAttribute(c as AttributeUpdateCommand, w),
  ],
  [
    'attribute.delete',
    (c, w) => deleteAttribute(c as AttributeDeleteCommand, w),
  ],
  ['attribute.move', (c, w) => moveAttribute(c as AttributeMoveCommand, w)],
  ['key.create', (c, w) => createKey(c as KeyCreateCommand, w)],
  ['key.update', (c, w) => updateKey(c as KeyUpdateCommand, w)],
  ['key.delete', (c, w) => deleteKey(c as KeyDeleteCommand, w)],
  ['key.move', (c, w) => moveKey(c as KeyMoveCommand, w)],
  [
    'subjectArea.create',
    (c, w) => createSubjectArea(c as SubjectAreaCreateCommand, w),
  ],
  [
    'subjectArea.update',
    (c, w) => updateSubjectArea(c as SubjectAreaUpdateCommand, w),
  ],
  [
    'subjectArea.delete',
    (c, w) => deleteSubjectArea(c as SubjectAreaDeleteCommand, w),
  ],
  [
    'subjectArea.addEntities',
    (c, w) => addEntities(c as SubjectAreaAddEntitiesCommand, w),
  ],
  [
    'subjectArea.removeEntities',
    (c, w) => removeEntities(c as SubjectAreaRemoveEntitiesCommand, w),
  ],
]);

/** The handler of a kind, or `undefined` for a kind without one. */
export function handlerOf(type: string): Handler | undefined {
  return HANDLERS.get(type);
}
