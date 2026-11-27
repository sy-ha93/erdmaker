import { relativePath } from '../../fs/path.js';
import type { Issue, ModelItem } from '../../model/types.js';
import { escapePointerToken } from '../../parse/pointer.js';
import { type Link, RuleContext } from './context.js';
import { entityIssues } from './entities.js';
import { linkIssues } from './links.js';
import {
  type Dictionary,
  type Entity,
  type Layout,
  type Manifest,
  readDictionary,
  readEntity,
  readLayout,
  readManifest,
  readRelationship,
  readSubjectArea,
  readSubtype,
  type Relationship,
  type SubjectArea,
  type Subtype,
} from './read.js';

/** The items that passed the schema and JSON value checks, each list in reading order. */
export interface RuleItems {
  manifest?: ModelItem<unknown>;
  dictionaries: ModelItem<unknown>[];
  entities: ModelItem<unknown>[];
  relationships: ModelItem<unknown>[];
  subtypes: ModelItem<unknown>[];
  subjectAreas: ModelItem<unknown>[];
  layouts: ModelItem<unknown>[];
}

/** R01 for an id that an earlier item of the same kind (`what`) has; `first` is that item's file. */
type Duplicate = (
  file: string,
  path: string,
  what: string,
  id: string,
  first: string,
) => void;

const read = <T>(
  items: ModelItem<unknown>[],
  reader: (file: string, data: unknown) => T | undefined,
): T[] => {
  const out: T[] = [];
  for (const { file, data } of items) {
    const found = reader(file, data);
    if (found !== undefined) out.push(found);
  }
  return out;
};

/**
 * The cross-file rules R01 to R12 (spec Appendix A) over items that passed
 * the schema and JSON value checks. `modelDir` is the model folder relative
 * to the opened folder; R01 names the other file relative to it, as the old
 * tool did. Issues carry no position yet. Every lookup goes through a map or
 * set, so the time is linear in the model and the issues it gives.
 */
export function ruleIssues(items: RuleItems, modelDir: string): Issue[] {
  const context = new RuleContext();
  const duplicate: Duplicate = (file, path, what, id, first) =>
    context.report(
      'R01',
      file,
      path,
      `duplicate ${what} id "${id}" (also in ${relativePath(modelDir, first)})`,
    );

  /** The first item of each id, added to `map`; R01 for the others. */
  const byId = <T extends { file: string; id: string }>(
    list: T[],
    what: string,
    map = new Map<string, T>(),
  ): Map<string, T> => {
    for (const item of list) {
      const first = map.get(item.id);
      if (first) {
        duplicate(item.file, '/id', what, item.id, first.file);
      } else {
        map.set(item.id, item);
      }
    }
    return map;
  };

  const dictionaries = read(items.dictionaries, readDictionary);
  const names = dictionaryIssues(context, dictionaries, duplicate);

  const entities = byId(
    read(items.entities, readEntity),
    'entity',
    context.entities,
  );
  const relationships = byId(
    read(items.relationships, readRelationship),
    'relationship',
  );
  const subtypes = byId(read(items.subtypes, readSubtype), 'subtype');
  const areas = byId(read(items.subjectAreas, readSubjectArea), 'subject area');
  const layouts = read(items.layouts, readLayout);

  const manifest = items.manifest
    ? readManifest(items.manifest.file, items.manifest.data)
    : undefined;
  const { schemas, groups } = manifestIssues(context, manifest);

  physicalIssues(context, entities.values(), schemas);
  groupIssues(context, areas.values(), groups);

  addLinks(context, relationships.values(), subtypes.values());
  for (const entity of entities.values()) {
    entityIssues(context, entity, names);
  }
  for (const link of context.links.values()) linkIssues(context, link);

  resolvedByIssues(context, relationships.values());
  discriminatorIssues(context, subtypes.values());
  areaEntityIssues(context, areas.values());
  layoutIssues(context, layouts, areas);
  return context.issues;
}

/** R01 within the dictionaries and R02 for the words and domain of each term; the term and domain ids. */
function dictionaryIssues(
  context: RuleContext,
  dictionaries: Dictionary[],
  duplicate: Duplicate,
) {
  const words = new Map<string, string>();
  const terms = new Map<
    string,
    { file: string; term: Dictionary['terms'][number] }
  >();
  const domains = new Map<string, string>();
  for (const dictionary of dictionaries) {
    const { file } = dictionary;
    for (const { index, value } of dictionary.words) {
      const first = words.get(value);
      if (first === undefined) words.set(value, file);
      else duplicate(file, `/words/${index}/id`, 'word', value, first);
    }
    for (const term of dictionary.terms) {
      const first = terms.get(term.id);
      if (first === undefined) terms.set(term.id, { file, term });
      else
        duplicate(file, `/terms/${term.index}/id`, 'term', term.id, first.file);
    }
    for (const { index, value } of dictionary.domains) {
      const first = domains.get(value);
      if (first === undefined) domains.set(value, file);
      else duplicate(file, `/domains/${index}/id`, 'domain', value, first);
    }
  }
  for (const { file, term } of terms.values()) {
    for (const { index, value } of term.words) {
      if (!words.has(value)) {
        context.report(
          'R02',
          file,
          `/terms/${term.index}/words/${index}`,
          `term "${term.id}": unknown word "${value}"`,
        );
      }
    }
    if (term.domain !== undefined && !domains.has(term.domain)) {
      context.report(
        'R02',
        file,
        `/terms/${term.index}/domain`,
        `term "${term.id}": unknown domain "${term.domain}"`,
      );
    }
  }
  return { terms: new Set(terms.keys()), domains: new Set(domains.keys()) };
}

/** R10 and R12 within `model.yaml`; the schema names and area group ids it lists. */
function manifestIssues(context: RuleContext, manifest: Manifest | undefined) {
  const schemas = new Set<string>();
  const groups = new Set<string>();
  if (!manifest) return { schemas, groups };
  for (const { index, value } of manifest.schemas) {
    if (schemas.has(value)) {
      context.report(
        'R10',
        manifest.file,
        `/schemas/${index}/name`,
        `duplicate schema "${value}"`,
      );
    }
    schemas.add(value);
  }
  for (const { index, value } of manifest.areaGroups) {
    if (groups.has(value)) {
      context.report(
        'R12',
        manifest.file,
        `/areaGroups/${index}/id`,
        `duplicate area group id "${value}"`,
      );
    }
    groups.add(value);
  }
  return { schemas, groups };
}

/** R10 for an entity's `physical.schema` and R11 for table names within a schema. */
function physicalIssues(
  context: RuleContext,
  entities: Iterable<Entity>,
  schemas: Set<string>,
) {
  // Table names by schema; an absent schema and `""` are the same one, as in the old tool.
  const tables = new Map<string, Map<string, string>>();
  for (const entity of entities) {
    const schema = entity.physicalSchema;
    if (schema !== undefined && schemas.size > 0 && !schemas.has(schema)) {
      context.report(
        'R10',
        entity.file,
        '/physical/schema',
        `physical.schema "${schema}" is not listed in model.yaml`,
      );
    }
    const name = entity.physicalName;
    if ((entity.scope ?? 'both') === 'logical' || !name) continue;
    let names = tables.get(schema ?? '');
    if (!names) {
      names = new Map();
      tables.set(schema ?? '', names);
    }
    const first = names.get(name);
    if (first === undefined) names.set(name, entity.id);
    else {
      context.report(
        'R11',
        entity.file,
        '/physical/name',
        `table name "${name}" is already used by "${first}" in the same schema`,
      );
    }
  }
}

/** The links of the model: relationships, then subtype members (R01 when an id is taken). */
function addLinks(
  context: RuleContext,
  relationships: Iterable<Relationship>,
  subtypes: Iterable<Subtype>,
) {
  for (const relationship of relationships) {
    const link: Link = {
      file: relationship.file,
      id: relationship.id,
      parent: relationship.parent,
      child: relationship.child,
      kind: relationship.kind,
      scope: relationship.scope ?? 'both',
      path: '',
      parentPath: '/parent',
      childPath: '/child',
      scopePath: relationship.scope === undefined ? '' : '/scope',
    };
    if (relationship.parentKey !== undefined) {
      link.parentKey = relationship.parentKey;
    }
    context.links.set(relationship.id, link);
  }
  for (const subtype of subtypes) {
    for (const member of subtype.members) {
      if (context.links.has(member.id)) {
        context.report(
          'R01',
          subtype.file,
          `/members/${member.index}/id`,
          `member id "${member.id}" clashes with another relationship or subtype member`,
        );
        continue;
      }
      context.links.set(member.id, {
        file: subtype.file,
        id: member.id,
        parent: subtype.supertype,
        child: member.entity,
        kind: 'subtype',
        scope: subtype.scope ?? 'both',
        path: `/members/${member.index}`,
        parentPath: '/supertype',
        childPath: `/members/${member.index}/entity`,
        scopePath: subtype.scope === undefined ? '' : '/scope',
      });
    }
  }
}

/** R09 for every layout, duplicates included. */
function layoutIssues(
  context: RuleContext,
  layouts: Layout[],
  areas: Map<string, SubjectArea>,
) {
  const seen = new Set<string>();
  const members = new Map<string, Set<string>>();
  for (const layout of layouts) {
    const area = layout.subjectArea ?? '';
    if (seen.has(area)) {
      context.report(
        'R09',
        layout.file,
        area ? '/subjectArea' : '',
        `second layout for ${area ? `subject area "${area}"` : 'the whole model'}`,
      );
    }
    seen.add(area);
    const subjectArea = area ? areas.get(area) : undefined;
    if (area && !subjectArea) {
      context.report(
        'R09',
        layout.file,
        '/subjectArea',
        `unknown subject area "${area}"`,
      );
    }
    let inArea: Set<string> | undefined;
    if (subjectArea) {
      inArea = members.get(area);
      if (!inArea) {
        inArea = new Set(subjectArea.entities.map((entry) => entry.value));
        members.set(area, inArea);
      }
    }
    for (const node of layout.nodes) {
      const path = `/nodes/${escapePointerToken(node)}`;
      if (!context.entities.has(node)) {
        context.report(
          'R09',
          layout.file,
          path,
          `node for unknown entity "${node}"`,
        );
      } else if (inArea && !inArea.has(node)) {
        context.report(
          'R09',
          layout.file,
          path,
          `entity "${node}" is not in subject area "${area}"`,
        );
      }
    }
    for (const edge of layout.edges) {
      if (!context.links.has(edge)) {
        context.report(
          'R09',
          layout.file,
          `/edges/${escapePointerToken(edge)}`,
          `edge for unknown relationship "${edge}"`,
        );
      }
    }
  }
}

/** R12 for a subject area in an area group that `model.yaml` does not list. */
function groupIssues(
  context: RuleContext,
  areas: Iterable<SubjectArea>,
  groups: Set<string>,
) {
  for (const area of areas) {
    if (area.group !== undefined && !groups.has(area.group)) {
      context.report(
        'R12',
        area.file,
        '/group',
        `unknown area group "${area.group}"`,
      );
    }
  }
}

/** R02 for a relationship resolved by an entity the model does not have. */
function resolvedByIssues(
  context: RuleContext,
  relationships: Iterable<Relationship>,
) {
  for (const relationship of relationships) {
    if (
      relationship.resolvedBy !== undefined &&
      !context.entities.has(relationship.resolvedBy)
    ) {
      context.report(
        'R02',
        relationship.file,
        '/resolvedBy',
        `unknown resolvedBy entity "${relationship.resolvedBy}"`,
      );
    }
  }
}

/** R02 for a discriminator that the supertype has no attribute for. */
function discriminatorIssues(
  context: RuleContext,
  subtypes: Iterable<Subtype>,
) {
  for (const subtype of subtypes) {
    const supertype = context.entities.get(subtype.supertype);
    if (
      subtype.discriminator !== undefined &&
      supertype &&
      !context.attribute(supertype, subtype.discriminator)
    ) {
      context.report(
        'R02',
        subtype.file,
        '/discriminator',
        `supertype "${subtype.supertype}" has no attribute "${subtype.discriminator}"`,
      );
    }
  }
}

/** R02 for a subject area entry that names no entity. */
function areaEntityIssues(context: RuleContext, areas: Iterable<SubjectArea>) {
  for (const area of areas) {
    for (const { index, value } of area.entities) {
      if (!context.entities.has(value)) {
        context.report(
          'R02',
          area.file,
          `/entities/${index}`,
          `unknown entity "${value}"`,
        );
      }
    }
  }
}
