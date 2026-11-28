import type { FileSpace } from './paths.js';
import { fitId, MAX_ID_LENGTH, slugify } from './slug.js';

/** A table name and schema, as an entity's `physical` holds them. */
export interface Physical {
  readonly name?: string;
  readonly schema?: string;
}

/**
 * One id namespace (spec FR-05) as id selection asks about it: entities,
 * subject areas, or the attributes or keys of one entity. The caller backs
 * it with sets, so each question is a constant number of lookups.
 */
export type IdSpace =
  | {
      readonly kind: 'entity';
      hasId(id: string): boolean;
      /** The `physical` of each entity with this id. */
      physicalsOf(id: string): Iterable<Physical | undefined>;
      readonly files: FileSpace;
    }
  | {
      readonly kind: 'subject area';
      hasId(id: string): boolean;
      readonly files: FileSpace;
    }
  | {
      readonly kind: 'attribute' | 'key';
      /** The id of the entity the namespace belongs to. */
      readonly entity: string;
      hasId(id: string): boolean;
    };

/** What a generated id is made from (spec FR-05, "재료"). */
export type IdSource =
  | {
      kind: 'entity' | 'attribute';
      name?: string;
      physicalName?: string;
    }
  | {
      kind: 'key';
      keyKind: 'primary' | 'alternate' | 'inversion';
      name?: string;
      physicalName?: string;
    }
  | { kind: 'subject area'; name?: string };

export type IdChoice =
  { ok: true; id: string } | { ok: false; message: string };

const KEY_WORDS = new Map([
  ['primary', 'pk'],
  ['alternate', 'ak'],
  ['inversion', 'ie'],
] as const);

const WINDOWS_NAMES = new Set(['con', 'prn', 'aux', 'nul']);
for (let n = 0; n <= 9; n += 1) WINDOWS_NAMES.add(`com${n}`).add(`lpt${n}`);

/** The first non-empty slug of `texts`, else `fallback`. */
function firstSlug(texts: (string | undefined)[], fallback: string): string {
  for (const text of texts) {
    if (text === undefined) continue;
    const slug = slugify(text);
    if (slug !== '') return slug;
  }
  return fallback;
}

/** The first candidate of a generated id: the slug of its material, or its word. */
export function idBase(source: IdSource): string {
  switch (source.kind) {
    case 'entity':
    case 'attribute':
      return firstSlug([source.physicalName, source.name], source.kind);
    case 'key':
      return firstSlug(
        [source.physicalName, source.name],
        KEY_WORDS.get(source.keyKind)!,
      );
    case 'subject area':
      return firstSlug([source.name], 'area');
  }
}

function cannot(kind: string, id: string, why: string): string {
  return `${kind} id "${id}" cannot be used: ${why}`;
}

/** Reason 1: the id is in the namespace. */
function taken(space: IdSpace, id: string): string | undefined {
  if (!space.hasId(id)) return undefined;
  return space.kind === 'attribute' || space.kind === 'key'
    ? `${space.kind} id "${id}" is already used in entity "${space.entity}"`
    : `${space.kind} id "${id}" is already used`;
}

/** Reason 3 for the file of `id`. */
function inDictionary(
  kind: string,
  files: FileSpace,
  id: string,
): string | undefined {
  const file = files.fileOf(id);
  const folder = files.dictionaryFolderOf(file);
  return folder === undefined
    ? undefined
    : cannot(kind, id, `${file} is inside the dictionary folder ${folder}`);
}

/** Reasons 4 and 5 for the file of `id`. */
function pathProblem(
  kind: string,
  files: FileSpace,
  id: string,
): string | undefined {
  const file = files.fileOf(id);
  if (files.isUsed(file)) return cannot(kind, id, `${file} is already in use`);
  const loaded = files.otherCase(file);
  return loaded === undefined
    ? undefined
    : cannot(kind, id, `a file with another letter case was loaded: ${loaded}`);
}

/**
 * Why `id` cannot be used in `space`, as the message of the first of the
 * five reasons of spec FR-05 it meets, or `undefined` when it can. `id` has
 * passed the id pattern.
 */
export function idProblem(space: IdSpace, id: string): string | undefined {
  const used = taken(space, id);
  if (used !== undefined || !('files' in space)) return used;
  if (WINDOWS_NAMES.has(id)) {
    return cannot(space.kind, id, 'it is a reserved file name on Windows');
  }
  return (
    inDictionary(space.kind, space.files, id) ??
    pathProblem(space.kind, space.files, id)
  );
}

/** Whether a generated candidate passes reasons 1, 2, 4 and 5. */
function available(space: IdSpace, id: string): boolean {
  if (space.hasId(id)) return false;
  if (!('files' in space)) return true;
  return (
    !WINDOWS_NAMES.has(id) &&
    pathProblem(space.kind, space.files, id) === undefined
  );
}

/**
 * Step 2 of spec FR-05: `<schema slug>_<base>` cut to 63 characters when an
 * entity with the id `base` and the new entity both have a table name, the
 * same one, in different schemas (a missing schema is `""`), and the new
 * schema has a slug.
 */
function prefixed(
  space: Extract<IdSpace, { kind: 'entity' }>,
  base: string,
  physical: Physical,
): string | undefined {
  const { name } = physical;
  if (name === undefined) return undefined;
  const schema = physical.schema ?? '';
  let differs = false;
  for (const other of space.physicalsOf(base)) {
    if (other?.name === name && (other.schema ?? '') !== schema) {
      differs = true;
      break;
    }
  }
  if (!differs) return undefined;
  const prefix = slugify(schema);
  return prefix === '' ? undefined : fitId(`${prefix}_${base}`);
}

/** `<stem>_<n>`, the stem cut so the whole is at most 63 characters. */
function suffixed(stem: string, n: number): string {
  const suffix = `_${n}`;
  const room = MAX_ID_LENGTH - suffix.length;
  return stem.length <= room
    ? `${stem}${suffix}`
    : `${fitId(stem.slice(0, room))}${suffix}`; // work-ok: a string, cut to fit an id
}

/**
 * A generated id (spec FR-05): the first candidate `base` can be used as,
 * in the order of the spec: `base`; for an entity the schema prefix (step
 * 2), which then is the stem of the suffixes; then `_2`, `_3`, …. A
 * candidate that comes again after cutting is skipped without asking, so
 * `space` is asked about each distinct candidate once. Reason 3 does not
 * depend on the id, so a file inside a dictionary folder refuses the first
 * candidate. `physical` is the new entity's.
 */
export function chooseId(
  space: IdSpace,
  base: string,
  physical: Physical = {},
): IdChoice {
  if ('files' in space) {
    const message = inDictionary(space.kind, space.files, base);
    if (message !== undefined) return { ok: false, message };
  }
  const seen = new Set<string>();
  const fits = (id: string): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    return available(space, id);
  };
  if (fits(base)) return { ok: true, id: base };
  let stem = base;
  if (space.kind === 'entity') {
    const withSchema = prefixed(space, base, physical);
    if (withSchema !== undefined) {
      if (fits(withSchema)) return { ok: true, id: withSchema };
      stem = withSchema;
    }
  }
  for (let n = 2; ; n += 1) {
    const id = suffixed(stem, n);
    if (fits(id)) return { ok: true, id };
  }
}
