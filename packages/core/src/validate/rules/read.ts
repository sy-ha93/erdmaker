import { compareCodeUnits } from '../../compare.js';
import { field, indexed } from '../plain.js';

/**
 * What the cross-file rules read from the items that passed the schema and
 * JSON value checks. The data is read once, as plain data (own data
 * properties, no getters), into these shapes, and the rules see nothing
 * else. The schema makes every required field present; an entry that still
 * lacks one (only a Proxy that answers differently on a second look can) is
 * left out rather than read further.
 */

/** An entry of a list in a file, with its index there. */
export interface Indexed<T> {
  index: number;
  value: T;
}

export interface Migration {
  index: number;
  relationship: string;
  attribute: string;
}

export interface Attribute {
  index: number;
  id: string;
  name: string;
  scope?: string;
  domain?: string;
  term?: string;
  /**
   * What R06 compares: `domain:<id>`, `type:<fields>` with the fields in
   * code unit order, or `none`. `undefined` when the type holds something
   * other than scalars, which the schema does not allow; it equals nothing.
   */
  type: string | undefined;
  rolenamed: boolean;
  migratedFrom: Migration[];
}

export interface Key {
  index: number;
  id: string;
  kind: string;
  attributes: Indexed<string>[];
}

export interface Entity {
  file: string;
  id: string;
  scope?: string;
  physicalName?: string;
  physicalSchema?: string;
  attributes: Attribute[];
  keys: Key[];
}

export interface Relationship {
  file: string;
  id: string;
  kind: string;
  parent: string;
  child: string;
  parentKey?: string;
  resolvedBy?: string;
  scope?: string;
}

export interface Member {
  index: number;
  id: string;
  entity: string;
}

export interface Subtype {
  file: string;
  id: string;
  supertype: string;
  discriminator?: string;
  scope?: string;
  members: Member[];
}

export interface SubjectArea {
  file: string;
  id: string;
  group?: string;
  entities: Indexed<string>[];
}

export interface Layout {
  file: string;
  subjectArea?: string;
  nodes: string[];
  edges: string[];
}

export interface Term {
  index: number;
  id: string;
  words: Indexed<string>[];
  domain?: string;
}

export interface Dictionary {
  file: string;
  words: Indexed<string>[];
  terms: Term[];
  domains: Indexed<string>[];
}

export interface Manifest {
  file: string;
  schemas: Indexed<string>[];
  areaGroups: Indexed<string>[];
}

const text = (value: unknown, key: string): string | undefined => {
  const found = field(value, key);
  return typeof found === 'string' ? found : undefined;
};

/** The entries of the list at `key` that `read` accepts, with their indexes. */
function entries<T>(
  value: unknown,
  key: string,
  read: (entry: unknown, index: number) => T | undefined,
): T[] {
  const out: T[] = [];
  for (const [index, entry] of indexed(field(value, key))) {
    const item = read(entry, index);
    if (item !== undefined) out.push(item);
  }
  return out;
}

/** The strings of the list at `key`, or the given field of each object in it. */
function strings(
  value: unknown,
  key: string,
  inner?: string,
): Indexed<string>[] {
  return entries(value, key, (entry, index) => {
    const found = inner === undefined ? entry : field(entry, inner);
    return typeof found === 'string' ? { index, value: found } : undefined;
  });
}

/** The own enumerable keys of an object; none when it is not one or throws. */
function keysOf(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [];
  }
  try {
    return Object.keys(value);
  } catch {
    return [];
  }
}

/** A data type's fields in code unit order, as one string; `undefined` if a field is not a scalar. */
function typeFields(type: unknown): string | undefined {
  const fields: string[] = [];
  for (const key of keysOf(type).sort(compareCodeUnits)) {
    const value = field(type, key);
    if (typeof value === 'object' && value !== null) return undefined;
    fields.push(JSON.stringify([key, value]));
  }
  return fields.join(',');
}

function attributeType(attribute: unknown): string | undefined {
  const domain = text(attribute, 'domain');
  if (domain !== undefined) return `domain:${domain}`;
  const type = field(attribute, 'type');
  if (type === undefined) return 'none';
  const fields = typeFields(type);
  return fields === undefined ? undefined : `type:${fields}`;
}

function readAttribute(entry: unknown, index: number): Attribute | undefined {
  const id = text(entry, 'id');
  const name = text(entry, 'name');
  if (id === undefined || name === undefined) return undefined;
  return {
    index,
    id,
    name,
    scope: text(entry, 'scope'),
    domain: text(entry, 'domain'),
    term: text(entry, 'term'),
    type: attributeType(entry),
    rolenamed: field(entry, 'rolenamed') === true,
    migratedFrom: entries(entry, 'migratedFrom', (from, at) => {
      const relationship = text(from, 'relationship');
      const attribute = text(from, 'attribute');
      return relationship === undefined || attribute === undefined
        ? undefined
        : { index: at, relationship, attribute };
    }),
  };
}

function readKey(entry: unknown, index: number): Key | undefined {
  const id = text(entry, 'id');
  const kind = text(entry, 'kind');
  if (id === undefined || kind === undefined) return undefined;
  return { index, id, kind, attributes: strings(entry, 'attributes') };
}

export function readEntity(file: string, data: unknown): Entity | undefined {
  const id = text(data, 'id');
  if (id === undefined) return undefined;
  const physical = field(data, 'physical');
  return {
    file,
    id,
    scope: text(data, 'scope'),
    physicalName: text(physical, 'name'),
    physicalSchema: text(physical, 'schema'),
    attributes: entries(data, 'attributes', readAttribute),
    keys: entries(data, 'keys', readKey),
  };
}

export function readRelationship(
  file: string,
  data: unknown,
): Relationship | undefined {
  const id = text(data, 'id');
  const kind = text(data, 'kind');
  const parent = text(data, 'parent');
  const child = text(data, 'child');
  if (
    id === undefined ||
    kind === undefined ||
    parent === undefined ||
    child === undefined
  ) {
    return undefined;
  }
  return {
    file,
    id,
    kind,
    parent,
    child,
    parentKey: text(data, 'parentKey'),
    resolvedBy: text(data, 'resolvedBy'),
    scope: text(data, 'scope'),
  };
}

export function readSubtype(file: string, data: unknown): Subtype | undefined {
  const id = text(data, 'id');
  const supertype = text(data, 'supertype');
  if (id === undefined || supertype === undefined) return undefined;
  return {
    file,
    id,
    supertype,
    discriminator: text(data, 'discriminator'),
    scope: text(data, 'scope'),
    members: entries(data, 'members', (entry, index) => {
      const member = text(entry, 'id');
      const entity = text(entry, 'entity');
      return member === undefined || entity === undefined
        ? undefined
        : { index, id: member, entity };
    }),
  };
}

export function readSubjectArea(
  file: string,
  data: unknown,
): SubjectArea | undefined {
  const id = text(data, 'id');
  if (id === undefined) return undefined;
  return {
    file,
    id,
    group: text(data, 'group'),
    entities: strings(data, 'entities'),
  };
}

export function readLayout(file: string, data: unknown): Layout {
  return {
    file,
    subjectArea: text(data, 'subjectArea'),
    nodes: keysOf(field(data, 'nodes')),
    edges: keysOf(field(data, 'edges')),
  };
}

export function readDictionary(file: string, data: unknown): Dictionary {
  return {
    file,
    words: strings(data, 'words', 'id'),
    terms: entries(data, 'terms', (entry, index) => {
      const id = text(entry, 'id');
      return id === undefined
        ? undefined
        : {
            index,
            id,
            words: strings(entry, 'words'),
            domain: text(entry, 'domain'),
          };
    }),
    domains: strings(data, 'domains', 'id'),
  };
}

export function readManifest(file: string, data: unknown): Manifest {
  return {
    file,
    schemas: strings(data, 'schemas', 'name'),
    areaGroups: strings(data, 'areaGroups', 'id'),
  };
}
