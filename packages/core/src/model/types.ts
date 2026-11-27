export type Severity = 'error' | 'warning';

/** A place in a file. Both numbers count from 1. */
export interface Position {
  line: number;
  column: number;
}

/** JSON Pointer (RFC 6901) inside one file's data → where it starts in the file text. */
export type PositionIndex = ReadonlyMap<string, Position>;

export interface Issue {
  rule:
    | 'syntax'
    | 'yaml-feature'
    | 'schema'
    | 'R01'
    | 'R02'
    | 'R03'
    | 'R04'
    | 'R05'
    | 'R06'
    | 'R07'
    | 'R08'
    | 'R09'
    | 'R10'
    | 'R11'
    | 'R12'
    | 'P01'
    | 'P02'
    | 'comment';
  severity: Severity;
  /** Relative to the opened folder. */
  file: string;
  /** JSON Pointer inside the file's data; `""` is the whole file. */
  path: string;
  /** Absent when the file has no position index or the path is not in it. */
  line?: number;
  column?: number;
  message: string;
}

/** A value as JSON holds it. `ext` holds these, owned by plugins and importers. */
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type Ext = { [key: string]: JsonValue };

export type Scope = 'both' | 'logical' | 'physical';

export type NameSource = 'manual' | 'comment' | 'dictionary' | 'inferred';

export interface DataType {
  base:
    | 'string'
    | 'integer'
    | 'decimal'
    | 'float'
    | 'boolean'
    | 'date'
    | 'time'
    | 'datetime'
    | 'binary'
    | 'json'
    | 'uuid';
  length?: number;
  precision?: number;
  scale?: number;
}

/** DBMS key → physical type text. */
export type PhysicalTypes = { [dbms: string]: string };

export interface ValidValue {
  value: string | number | boolean;
  meaning?: string;
}

export type DefaultValue = string | number | boolean | { expression: string };

/** `model.yaml`. */
export interface ManifestData {
  formatVersion: '0.1';
  id: string;
  name: string;
  definition?: string;
  notation?: 'ie' | 'idef1x';
  targets?: { dbms: string; version?: string }[];
  schemas?: {
    name: string;
    role?: 'main' | 'linked';
    definition?: string;
  }[];
  dictionaries?: string[];
  areaGroups?: { id: string; name: string; definition?: string }[];
  ext?: Ext;
}

export interface AttributeData {
  id: string;
  name: string;
  definition?: string;
  note?: string;
  /** Absent: the attribute has its entity's scope. */
  scope?: Scope;
  term?: string;
  domain?: string;
  type?: DataType;
  nullable?: boolean;
  default?: DefaultValue;
  validValues?: ValidValue[];
  physical?: { name?: string; types?: PhysicalTypes };
  migratedFrom?: { relationship: string; attribute: string }[];
  rolenamed?: boolean;
  nameSource?: NameSource;
  ext?: Ext;
}

export interface KeyData {
  id: string;
  kind: 'primary' | 'alternate' | 'inversion';
  name?: string;
  attributes: string[];
  scope?: Scope;
  physical?: { name?: string };
  ext?: Ext;
}

/** `entities/*.yaml`. */
export interface EntityData {
  id: string;
  name: string;
  definition?: string;
  note?: string;
  scope?: Scope;
  nameSource?: NameSource;
  physical?: { name?: string; schema?: string };
  attributes: AttributeData[];
  keys?: KeyData[];
  ext?: Ext;
}

export type ReferentialAction =
  'cascade' | 'restrict' | 'set-null' | 'set-default' | 'none';

/** `relationships/*.yaml`. */
export interface RelationshipData {
  id: string;
  kind: 'identifying' | 'non-identifying' | 'many-to-many';
  parent: string;
  child: string;
  name?: string;
  definition?: string;
  verbPhrase?: { parentToChild?: string; childToParent?: string };
  cardinality?: {
    parent?: 'one' | 'zero-or-one';
    child?: 'zero-or-more' | 'one-or-more' | 'zero-or-one' | 'exactly';
    count?: number;
  };
  parentKey?: string;
  referentialIntegrity?: {
    parentInsert?: ReferentialAction;
    parentUpdate?: ReferentialAction;
    parentDelete?: ReferentialAction;
    childInsert?: ReferentialAction;
    childUpdate?: ReferentialAction;
    childDelete?: ReferentialAction;
  };
  resolvedBy?: string;
  scope?: Scope;
  physical?: { name?: string };
  ext?: Ext;
}

/** `subtypes/*.yaml`. */
export interface SubtypeData {
  id: string;
  supertype: string;
  discriminator?: string;
  completeness?: 'complete' | 'incomplete';
  exclusivity?: 'exclusive' | 'inclusive';
  members: {
    id: string;
    entity: string;
    discriminatorValue?: string | number | boolean;
  }[];
  definition?: string;
  scope?: Scope;
  ext?: Ext;
}

/** `subject-areas/*.yaml`. */
export interface SubjectAreaData {
  id: string;
  name: string;
  definition?: string;
  group?: string;
  order?: number;
  entities: string[];
  ext?: Ext;
}

export type Side = 'top' | 'right' | 'bottom' | 'left';

/** `layouts/*.json`. */
export interface LayoutData {
  formatVersion: '0.1';
  /** Absent: the whole-model diagram. */
  subjectArea?: string;
  display?: {
    level?: 'entity' | 'key' | 'attribute';
    names?: 'logical' | 'physical' | 'both';
  };
  nodes: {
    [entity: string]: {
      x: number;
      y: number;
      width?: number;
      height?: number;
      color?: string;
    };
  };
  edges?: {
    [relationship: string]: {
      parentSide?: Side;
      childSide?: Side;
      waypoints?: { x: number; y: number }[];
    };
  };
  ext?: Ext;
}

/** One file of a dictionary folder. */
export interface DictionaryData {
  words?: {
    id: string;
    name: string;
    englishName?: string;
    abbreviation?: string;
    definition?: string;
    classifier?: boolean;
    synonyms?: string[];
    forbiddenWords?: string[];
    ext?: Ext;
  }[];
  terms?: {
    id: string;
    name: string;
    words?: string[];
    physicalName?: string;
    domain?: string;
    definition?: string;
    synonyms?: string[];
    ext?: Ext;
  }[];
  domains?: {
    id: string;
    name: string;
    category?: string;
    type: DataType;
    physicalTypes?: PhysicalTypes;
    validValues?: ValidValue[];
    default?: DefaultValue;
    definition?: string;
    ext?: Ext;
  }[];
  ext?: Ext;
}

/** One object of the model and the file it was read from (relative to the opened folder). */
export interface ModelItem<T> {
  file: string;
  /** Shaped as the file's schema; defaults are not filled in. */
  data: T;
}

/**
 * A model folder in memory: plain data, as the files hold it. Positions are
 * kept apart (see `loadModel`).
 */
export interface Model {
  /** The model folder, relative to the opened folder (`""` when it is the opened folder). */
  dir: string;
  /** Absent when `model.yaml` could not be read into the model. */
  manifest?: ModelItem<ManifestData>;
  entities: ModelItem<EntityData>[];
  relationships: ModelItem<RelationshipData>[];
  subtypes: ModelItem<SubtypeData>[];
  subjectAreas: ModelItem<SubjectAreaData>[];
  layouts: ModelItem<LayoutData>[];
  /** One item per dictionary file, in reading order. */
  dictionaries: ModelItem<DictionaryData>[];
}
