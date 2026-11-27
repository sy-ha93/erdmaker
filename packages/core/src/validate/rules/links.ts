import { type Link, type RuleContext, scopeFits } from './context.js';

/**
 * One link's rules: its entities exist (R02), its scope fits both (R08,
 * many-to-many included), and, unless it is many-to-many, the key it
 * migrates (R02, R04) reaches the child as the format requires (R04, R05).
 */
export function linkIssues(context: RuleContext, link: Link): void {
  const { file, id } = link;
  const parent = context.entities.get(link.parent);
  const child = context.entities.get(link.child);
  if (!parent) {
    context.report(
      'R02',
      file,
      link.parentPath,
      `"${id}": unknown parent entity "${link.parent}"`,
    );
  }
  if (!child) {
    context.report(
      'R02',
      file,
      link.childPath,
      `"${id}": unknown child entity "${link.child}"`,
    );
  }
  if (!parent || !child) return;
  for (const [side, entity] of [
    ['parent', parent],
    ['child', child],
  ] as const) {
    if (!scopeFits(link.scope, entity.scope ?? 'both')) {
      context.report(
        'R08',
        file,
        link.scopePath,
        `"${id}": scope is wider than its ${side} entity's`,
      );
    }
  }
  if (link.kind === 'many-to-many') return;

  const key = context.migratedKey(link, parent);
  if (link.parentKey !== undefined) {
    if (!key) {
      context.report(
        'R02',
        file,
        '/parentKey',
        `"${id}": parent "${parent.id}" has no key "${link.parentKey}" to migrate`,
      );
      return;
    }
    // Reported, and the key is still checked as the one the link migrates.
    if (key.kind !== 'alternate') {
      context.report(
        'R04',
        file,
        '/parentKey',
        `"${id}": parentKey "${link.parentKey}" must be an alternate key of "${parent.id}"`,
      );
    }
  } else if (!key) {
    context.report(
      'R04',
      file,
      link.path,
      `"${id}": parent "${parent.id}" has no primary key to migrate`,
    );
    return;
  }

  const primary = context.primaryKey(child);
  const childPrimary = primary
    ? context.keyAttributes(primary)
    : new Set<string>();
  for (const { value: parentAttribute } of key.attributes) {
    const targets = context.targets(child, id, parentAttribute);
    if (targets.length !== 1) {
      context.report(
        'R04',
        file,
        link.path,
        `"${id}": ${parent.id}.${parentAttribute} must migrate to exactly one attribute of "${child.id}" (found ${targets.length})`,
      );
    }
    for (const target of targets) {
      const inPrimary = childPrimary.has(target);
      if (
        (link.kind === 'identifying' || link.kind === 'subtype') &&
        !inPrimary
      ) {
        context.report(
          'R05',
          file,
          link.path,
          `"${id}": ${child.id}.${target} must be part of the child's primary key`,
        );
      }
      if (
        link.kind === 'non-identifying' &&
        inPrimary &&
        childPrimary.size === 1
      ) {
        context.report(
          'R05',
          file,
          link.path,
          `"${id}": non-identifying, but ${child.id}.${target} is the child's whole primary key`,
        );
      }
    }
  }
}
