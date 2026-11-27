import { type RuleContext, scopeFits } from './context.js';
import type { Attribute, Entity, Migration } from './read.js';

/** The dictionary ids an attribute may name. */
export interface Names {
  domains: ReadonlySet<string>;
  terms: ReadonlySet<string>;
}

/**
 * One entity's rules: its attributes (R01, R02, R08, and R02, R04, R06, R07
 * for what they migrate) and its keys (R01, R02, R03).
 */
export function entityIssues(
  context: RuleContext,
  entity: Entity,
  names: Names,
): void {
  const { file } = entity;
  const entityScope = entity.scope ?? 'both';
  const ids = new Set<string>();
  for (const attribute of entity.attributes) {
    const at = `/attributes/${attribute.index}`;
    const label = `attribute "${attribute.id}"`;
    if (ids.has(attribute.id)) {
      context.report(
        'R01',
        file,
        `${at}/id`,
        `duplicate attribute id "${attribute.id}"`,
      );
    }
    ids.add(attribute.id);
    if (
      attribute.domain !== undefined &&
      !names.domains.has(attribute.domain)
    ) {
      context.report(
        'R02',
        file,
        `${at}/domain`,
        `${label}: unknown domain "${attribute.domain}"`,
      );
    }
    if (attribute.term !== undefined && !names.terms.has(attribute.term)) {
      context.report(
        'R02',
        file,
        `${at}/term`,
        `${label}: unknown term "${attribute.term}"`,
      );
    }
    // An attribute without a scope has its entity's, which always fits.
    if (!scopeFits(attribute.scope ?? entityScope, entityScope)) {
      context.report(
        'R08',
        file,
        `${at}/scope`,
        `${label}: scope is wider than its entity's`,
      );
    }
    for (const from of attribute.migratedFrom) {
      migrationIssues(context, entity, attribute, from);
    }
  }

  const keyIds = new Set<string>();
  let primaries = 0;
  for (const key of entity.keys) {
    const at = `/keys/${key.index}`;
    if (keyIds.has(key.id)) {
      context.report('R01', file, `${at}/id`, `duplicate key id "${key.id}"`);
    }
    keyIds.add(key.id);
    for (const { index, value } of key.attributes) {
      if (!ids.has(value)) {
        context.report(
          'R02',
          file,
          `${at}/attributes/${index}`,
          `key "${key.id}": unknown attribute "${value}"`,
        );
      }
    }
    if (key.kind === 'primary') {
      primaries += 1;
      // One issue however many more there are, at the second.
      if (primaries === 2) {
        context.report('R03', file, at, 'more than one primary key');
      }
    }
  }
}

/** What one `migratedFrom` entry of an attribute must match. */
function migrationIssues(
  context: RuleContext,
  entity: Entity,
  attribute: Attribute,
  from: Migration,
): void {
  const { file } = entity;
  const at = `/attributes/${attribute.index}`;
  const fromAt = `${at}/migratedFrom/${from.index}`;
  const label = `attribute "${attribute.id}"`;
  const link = context.links.get(from.relationship);
  if (!link) {
    context.report(
      'R02',
      file,
      `${fromAt}/relationship`,
      `${label}: unknown relationship "${from.relationship}"`,
    );
    return;
  }
  if (link.child !== entity.id) {
    context.report(
      'R04',
      file,
      `${fromAt}/relationship`,
      `${label}: "${from.relationship}" does not have this entity as its child`,
    );
  }
  const manyToMany = link.kind === 'many-to-many';
  if (manyToMany) {
    context.report(
      'R04',
      file,
      `${fromAt}/relationship`,
      `${label}: a many-to-many relationship migrates nothing`,
    );
  }
  const parent = context.entities.get(link.parent);
  const source = parent ? context.attribute(parent, from.attribute) : undefined;
  const parentAttribute = `${link.parent}.${from.attribute}`;
  if (!parent || !source) {
    context.report(
      'R02',
      file,
      `${fromAt}/attribute`,
      `${label}: parent "${link.parent}" has no attribute "${from.attribute}"`,
    );
  } else {
    // An attribute whose type holds other than scalars (`undefined`) equals nothing.
    if (
      source.type === undefined ||
      attribute.type === undefined ||
      source.type !== attribute.type
    ) {
      context.report(
        'R06',
        file,
        at,
        `${label}: type differs from ${parentAttribute}`,
      );
    }
    if (!attribute.rolenamed && source.name !== attribute.name) {
      context.report(
        'R06',
        file,
        `${at}/name`,
        `${label}: name differs from ${parentAttribute} but rolenamed is not set`,
      );
    }
    const key = manyToMany ? undefined : context.migratedKey(link, parent);
    if (key && !context.keyAttributes(key).has(from.attribute)) {
      context.report(
        'R04',
        file,
        `${fromAt}/attribute`,
        `${label}: ${parentAttribute} is not part of the key that "${link.id}" migrates`,
      );
    }
  }
  if (link.parent === link.child && !attribute.rolenamed) {
    context.report(
      'R07',
      file,
      at,
      `${label}: a recursive relationship needs a rolename`,
    );
  }
}
