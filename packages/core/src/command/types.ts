import type {
  DataType,
  DefaultValue,
  Ext,
  Issue,
  KeyData,
  NameSource,
  PhysicalTypes,
  ReadonlyModel,
  Scope,
  ValidValue,
} from '../model/types.js';

/** Fields every entity command may set (spec appendix A). */
interface EntityFields {
  name: string;
  definition?: string;
  note?: string;
  scope?: Scope;
  nameSource?: NameSource;
  physical?: { name?: string; schema?: string };
  ext?: Ext;
}

export interface EntityCreateCommand extends EntityFields {
  type: 'entity.create';
  id?: string;
  /** A subject area the new entity joins. */
  subjectArea?: string;
}

export interface EntityUpdateCommand {
  type: 'entity.update';
  id: string;
  set?: Partial<EntityFields>;
  unset?: readonly (
    | 'definition'
    | 'note'
    | 'scope'
    | 'nameSource'
    | 'physical'
    | 'physical.name'
    | 'physical.schema'
    | 'ext'
  )[];
}

export interface EntityDeleteCommand {
  type: 'entity.delete';
  id: string;
}

/** Fields every attribute command may set, `type` named as the attribute's data field. */
interface AttributeFields {
  name: string;
  definition?: string;
  note?: string;
  scope?: Scope;
  term?: string;
  domain?: string;
  type?: DataType;
  nullable?: boolean;
  default?: DefaultValue;
  validValues?: readonly ValidValue[];
  physical?: { name?: string; types?: PhysicalTypes };
  nameSource?: NameSource;
  ext?: Ext;
}

export interface AttributeCreateCommand extends Omit<AttributeFields, 'type'> {
  type: 'attribute.create';
  entity: string;
  id?: string;
  /** Stored as the attribute's `type` (the command's `type` names the command). */
  dataType?: DataType;
  /** The attribute it goes before; absent: the end. */
  before?: string;
}

export interface AttributeUpdateCommand {
  type: 'attribute.update';
  entity: string;
  id: string;
  set?: Partial<AttributeFields>;
  unset?: readonly (
    | 'definition'
    | 'note'
    | 'scope'
    | 'term'
    | 'domain'
    | 'type'
    | 'nullable'
    | 'default'
    | 'validValues'
    | 'physical'
    | 'physical.name'
    | 'physical.types'
    | 'nameSource'
    | 'ext'
  )[];
}

export interface AttributeDeleteCommand {
  type: 'attribute.delete';
  entity: string;
  id: string;
}

export interface AttributeMoveCommand {
  type: 'attribute.move';
  entity: string;
  id: string;
  before?: string;
}

interface KeyFields {
  kind: KeyData['kind'];
  name?: string;
  attributes: readonly string[];
  scope?: Scope;
  physical?: { name?: string };
  ext?: Ext;
}

export interface KeyCreateCommand extends KeyFields {
  type: 'key.create';
  entity: string;
  id?: string;
  before?: string;
}

export interface KeyUpdateCommand {
  type: 'key.update';
  entity: string;
  id: string;
  set?: Partial<KeyFields>;
  unset?: readonly ('name' | 'scope' | 'physical' | 'physical.name' | 'ext')[];
}

export interface KeyDeleteCommand {
  type: 'key.delete';
  entity: string;
  id: string;
}

export interface KeyMoveCommand {
  type: 'key.move';
  entity: string;
  id: string;
  before?: string;
}

interface SubjectAreaFields {
  name: string;
  definition?: string;
  group?: string;
  order?: number;
  ext?: Ext;
}

export interface SubjectAreaCreateCommand extends SubjectAreaFields {
  type: 'subjectArea.create';
  id?: string;
  /** Absent: none. */
  entities?: readonly string[];
}

export interface SubjectAreaUpdateCommand {
  type: 'subjectArea.update';
  id: string;
  set?: Partial<SubjectAreaFields>;
  unset?: readonly ('definition' | 'group' | 'order' | 'ext')[];
}

export interface SubjectAreaDeleteCommand {
  type: 'subjectArea.delete';
  id: string;
}

export interface SubjectAreaAddEntitiesCommand {
  type: 'subjectArea.addEntities';
  id: string;
  entities: readonly string[];
}

export interface SubjectAreaRemoveEntitiesCommand {
  type: 'subjectArea.removeEntities';
  id: string;
  entities: readonly string[];
}

/** Every command but `batch`: what a batch holds. */
export type SubCommand =
  | EntityCreateCommand
  | EntityUpdateCommand
  | EntityDeleteCommand
  | AttributeCreateCommand
  | AttributeUpdateCommand
  | AttributeDeleteCommand
  | AttributeMoveCommand
  | KeyCreateCommand
  | KeyUpdateCommand
  | KeyDeleteCommand
  | KeyMoveCommand
  | SubjectAreaCreateCommand
  | SubjectAreaUpdateCommand
  | SubjectAreaDeleteCommand
  | SubjectAreaAddEntitiesCommand
  | SubjectAreaRemoveEntitiesCommand;

/** Sub-commands applied in turn, all or none (spec FR-08). */
export interface BatchCommand {
  type: 'batch';
  commands: readonly SubCommand[];
}

/** One change to a model, as plain JSON data (spec appendix A). */
export type Command = SubCommand | BatchCommand;

export type CommandType = Command['type'];

/** Why a call was refused (spec appendix B). */
export type RejectionCode =
  | 'invalid-command'
  | 'not-found'
  | 'ambiguous-target'
  | 'id-taken'
  | 'validation'
  | 'nothing-to-undo'
  | 'nothing-to-redo'
  | 'internal';

export type Issues = readonly Readonly<Issue>[];

export type CommandResult =
  | {
      ok: true;
      model: ReadonlyModel;
      issues: Issues;
      /** The id a create command gave its object. */
      id?: string;
      /** A batch's: per sub-command, the id a create gave, otherwise `null`. */
      ids?: (string | null)[];
    }
  | {
      ok: false;
      code: RejectionCode;
      message: string;
      issues: Issues;
      /** A batch's: the sub-command that was refused. */
      index?: number;
    };

/** Runs commands on one model, with undo and redo (spec FR-01). */
export interface Editor {
  /** The model now. */
  readonly model: ReadonlyModel;
  /** `validateModel` of the model now. */
  readonly issues: Issues;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  execute(command: unknown): CommandResult;
  undo(): CommandResult;
  redo(): CommandResult;
}
