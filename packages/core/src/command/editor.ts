import type { Issue, ReadonlyModel } from '../model/types.js';
import { validateModel } from '../validate/index.js';
import {
  endModel,
  errorCount,
  rejectionIssues,
  reuseIssues,
} from './changes.js';
import { checkCommand, readCommand } from './check.js';
import { oneLineMessage } from './message.js';
import { readModelShape } from './model-shape.js';
import {
  dictionaryFolders,
  InitialPaths,
  pathKeys,
  reservedPaths,
} from './paths.js';
import { handlerOf } from './registry.js';
import type {
  CommandResult,
  Editor,
  Issues,
  RejectionCode,
  SubCommand,
} from './types.js';
import { type EditorPlaces, Working } from './working.js';

/** The most steps undo keeps (spec FR-08). */
const HISTORY = 100;

const NOT_A_LIST =
  'Cannot edit the model: reservedFiles is not a list of paths';

/** A model and its issues: the editor's state, and one history step. */
interface Snapshot {
  readonly model: ReadonlyModel;
  readonly issues: Issues;
}

type Rejection = Extract<CommandResult, { ok: false }>;

/** A refusal, its message made one line and cut (spec FR-03). */
function refuse(
  code: RejectionCode,
  message: string,
  index?: number,
  issues: Issues = [],
): Rejection {
  const text = oneLineMessage(
    index === undefined ? message : `commands[${index}]: ${message}`,
  );
  return index === undefined
    ? { ok: false, code, message: text, issues }
    : { ok: false, code, message: text, issues, index };
}

/** A thrown value's text: an `Error`'s message, else `String`, else `unknown error`. */
function errorText(error: unknown): string {
  try {
    return error instanceof Error ? String(error.message) : String(error);
  } catch {
    return 'unknown error';
  }
}

/** `Unexpected error: <message>` for a thrown value (spec appendix B). */
function unexpected(error: unknown, index?: number): Rejection {
  return refuse('internal', `Unexpected error: ${errorText(error)}`, index);
}

const BROKEN = 'The command would break the model: ';

/** The `schema` issues of `file` in `issues`, in their order. */
function schemaIssuesOf(issues: Issues, file: string): Readonly<Issue>[] {
  const kept: Readonly<Issue>[] = [];
  for (const issue of issues) {
    if (issue.rule === 'schema' && issue.file === file) kept.push(issue);
  }
  return kept;
}

const BUSY: Rejection = {
  ok: false,
  code: 'internal',
  message: 'The editor is busy',
  issues: [],
};

/**
 * The `reservedFiles` of `options`, read once; reading it may throw. A value
 * that is not an object (`undefined`, `null`, a function) is no options.
 */
function reservedOption(options: unknown): unknown {
  if (typeof options !== 'object' || options === null) return [];
  try {
    const files = (options as { reservedFiles?: unknown }).reservedFiles;
    return files === undefined ? [] : files;
  } catch {
    throw new TypeError(NOT_A_LIST);
  }
}

class ModelEditor implements Editor {
  private current: Snapshot;
  private readonly undoSteps: Snapshot[] = [];
  private readonly redoSteps: Snapshot[] = [];
  private busy = false;

  constructor(
    model: ReadonlyModel,
    private readonly places: EditorPlaces,
  ) {
    this.current = { model, issues: validateModel(model) };
  }

  get model(): ReadonlyModel {
    return this.current.model;
  }

  get issues(): Issues {
    return this.current.issues;
  }

  get canUndo(): boolean {
    return this.undoSteps.length > 0;
  }

  get canRedo(): boolean {
    return this.redoSteps.length > 0;
  }

  execute(command: unknown): CommandResult {
    return this.guard(() => this.run(command));
  }

  undo(): CommandResult {
    return this.guard(() =>
      this.step(
        this.undoSteps,
        this.redoSteps,
        'nothing-to-undo',
        'Nothing to undo',
      ),
    );
  }

  redo(): CommandResult {
    return this.guard(() =>
      this.step(
        this.redoSteps,
        this.undoSteps,
        'nothing-to-redo',
        'Nothing to redo',
      ),
    );
  }

  /** Runs `call` unless a call is running already; never throws. */
  private guard(call: () => CommandResult): CommandResult {
    if (this.busy) return { ...BUSY, issues: [] }; // work-ok: the fields of one refusal record
    this.busy = true;
    try {
      return call();
    } catch (error) {
      return unexpected(error);
    } finally {
      this.busy = false;
    }
  }

  private step(
    from: Snapshot[],
    to: Snapshot[],
    code: RejectionCode,
    message: string,
  ): CommandResult {
    const back = from[from.length - 1];
    if (!back) return refuse(code, message);
    from.pop();
    to.push(this.current);
    this.current = back;
    return { ok: true, model: back.model, issues: back.issues };
  }

  private run(input: unknown): CommandResult {
    const read = readCommand(input);
    if (!read.ok) return refuse('invalid-command', read.message);
    const command = read.command;
    const inBatch = command.type === 'batch';
    const commands: readonly unknown[] = inBatch ? command.commands : [command];

    // A single command goes the way of a batch of one (analysis E8).
    const working = new Working(this.current.model, this.places);
    const ids: (string | null)[] = [];
    let id: string | undefined;
    for (let i = 0; i < commands.length; i += 1) {
      const at = inBatch ? i : undefined;
      let sub = commands[i] as SubCommand;
      if (inBatch) {
        const copy = sub as unknown as Record<string, unknown>;
        if (Object.hasOwn(copy, 'type') && copy.type === 'batch') {
          return refuse('invalid-command', 'a batch cannot hold a batch', i);
        }
        const checked = checkCommand(copy);
        if (!checked.ok) return refuse('invalid-command', checked.message, i);
        sub = checked.command as SubCommand;
      }
      const handler = handlerOf(sub.type);
      let done;
      try {
        if (!handler) throw new Error(`no handler for ${sub.type}`);
        done = handler(sub, working);
      } catch (error) {
        return unexpected(error, at);
      }
      if (!done.ok) return refuse(done.code, done.message, at);
      ids.push(done.id ?? null);
      id = done.id;
    }

    const made = inBatch ? { ids } : id === undefined ? {} : { id };
    const before = this.current;
    const { model, unwritable } = endModel(working);
    if (model === before.model) {
      return { ok: true, model, issues: before.issues, ...made }; // work-ok: the id or ids field of the result record
    }
    const found: Issue[] = validateModel(model);
    // Both must hold (spec FR-04). (a) Every item the command changed or
    // made can be written, unless the same item could not be before.
    if (unwritable) {
      return refuse(
        'validation',
        `${BROKEN}${errorText(unwritable.error)}`,
        undefined,
        schemaIssuesOf(found, unwritable.file),
      );
    }
    // (b) No more errors than before.
    if (errorCount(found) > errorCount(before.issues)) {
      const issues = rejectionIssues(before.issues, found);
      const first = issues[0]!;
      return refuse(
        'validation',
        `${BROKEN}${first.file}: ${first.message}`,
        undefined,
        issues,
      );
    }
    const next: Snapshot = { model, issues: reuseIssues(before.issues, found) };

    // Everything has succeeded: only assignments from here on.
    this.undoSteps.push(before);
    if (this.undoSteps.length > HISTORY) this.undoSteps.shift();
    this.redoSteps.length = 0;
    this.current = next;
    return { ok: true, model: next.model, issues: next.issues, ...made }; // work-ok: the id or ids field of the result record
  }
}

/**
 * An editor of `model` (spec FR-01). Throws a `TypeError` starting with
 * `Cannot edit the model: ` when the model breaks a condition of FR-01, or
 * when the `reservedFiles` of an object `options` is not an array of
 * strings; nothing else throws. `options` that is not an object is none.
 * Calls `validateModel` once.
 */
export function createEditor(
  model: ReadonlyModel,
  options?: { reservedFiles?: readonly string[] },
): Editor {
  const read = readModelShape(model);
  if ('reason' in read) {
    throw new TypeError(`Cannot edit the model: ${read.reason}`);
  }
  const { shape } = read;
  const files: string[] = [];
  if (shape.manifest) files.push(shape.manifest.file);
  for (const item of shape.items) files.push(item.file);
  for (const item of shape.dictionaries) files.push(item.file);
  const initial = new InitialPaths(files);
  const reserved = reservedPaths(reservedOption(options), initial);
  return new ModelEditor(model, {
    initial,
    reservedKeys: pathKeys(reserved),
    dictionaryFolders: dictionaryFolders(shape.dir, shape.manifest?.item),
  });
}
