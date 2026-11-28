import type { AnySchemaObject, ValidateFunction } from 'ajv/dist/2020.js';
import { prepareSchema, schemaAjv } from '../schema/ajv.js';
import { compareIssues } from '../validate/issues.js';
import { validatorIssues } from '../validate/schema.js';
import { copyCommand } from './copy.js';
import { commandSchemas } from './schemas.js';
import type { Command, CommandType } from './types.js';

/** A command that passed the input checks, or why it did not (before the one-line treatment). */
export type ReadResult =
  { ok: true; command: Command } | { ok: false; message: string };

/** The schemas by kind, looked up with a user's text: a `Map`, so `constructor` is no kind. */
const SCHEMAS: ReadonlyMap<string, (typeof commandSchemas)[CommandType]> =
  new Map(Object.entries(commandSchemas));

/** How much of an unknown `type` a message shows, in code units. */
const TYPE_SHOWN = 50;

const validators = new Map<CommandType, ValidateFunction>();

/**
 * The compiled check of one kind: its schema prepared as the format's are
 * and compiled by the one Ajv instance, on first use.
 */
export function commandValidator(type: CommandType): ValidateFunction {
  let validate = validators.get(type);
  if (!validate) {
    const schema = commandSchemas[type] as Record<string, unknown>;
    validate = schemaAjv().compile(
      prepareSchema(schema, schema) as AnySchemaObject,
    );
    validators.set(type, validate);
  }
  return validate;
}

/**
 * Steps 3 and 4 of spec FR-03 for a plain copy (a command, or a batch's
 * sub-command): its own `type` names a kind, and it fits that kind's
 * schema. Of several schema errors, the first in issue order.
 */
export function checkCommand(
  copy: Readonly<Record<string, unknown>>,
): ReadResult {
  const type = Object.hasOwn(copy, 'type') ? copy.type : undefined;
  if (typeof type !== 'string') {
    return { ok: false, message: 'command type must be a string' };
  }
  if (!SCHEMAS.has(type)) {
    const shown =
      type.length > TYPE_SHOWN ? `${type.slice(0, TYPE_SHOWN)}…` : type;
    return {
      ok: false,
      message: `unknown command type ${JSON.stringify(shown)}`,
    };
  }
  const issues = validatorIssues(
    '',
    commandValidator(type as CommandType),
    copy,
  );
  let first = issues[0];
  for (const issue of issues) {
    if (compareIssues(issue, first!) < 0) first = issue;
  }
  if (first) return { ok: false, message: first.message };
  return { ok: true, command: copy as unknown as Command };
}

/**
 * Steps 1 to 4 of spec FR-03 for an untrusted value: a plain copy of it
 * checked, or the first failure. A batch is checked as an envelope; its
 * sub-commands are left to `checkCommand`. Never throws.
 */
export function readCommand(input: unknown): ReadResult {
  const copied = copyCommand(input);
  if (!copied.ok) return copied;
  return checkCommand(copied.value);
}
