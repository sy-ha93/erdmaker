import type { HandlerResult } from './find.js';
import { createEntity, deleteEntity, updateEntity } from './handlers/entity.js';
import type {
  EntityCreateCommand,
  EntityDeleteCommand,
  EntityUpdateCommand,
  SubCommand,
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
]);

/** The handler of a kind, or `undefined` for a kind without one yet. */
export function handlerOf(type: string): Handler | undefined {
  return HANDLERS.get(type);
}
