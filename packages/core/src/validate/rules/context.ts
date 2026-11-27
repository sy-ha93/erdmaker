import type { Issue } from '../../model/types.js';
import type { Attribute, Entity, Key } from './read.js';

/**
 * Anything that migrates a key: a relationship, or a subtype member (from
 * the supertype to the member entity). Paths are in the link's file.
 */
export interface Link {
  file: string;
  id: string;
  parent: string;
  child: string;
  /** The relationship's kind, or `subtype` for a member. */
  kind: string;
  parentKey?: string;
  /** `both` when the file gives none. */
  scope: string;
  /** The link itself: `""` for a relationship, `/members/<i>` for a member. */
  path: string;
  parentPath: string;
  childPath: string;
  /** Where the scope is, or the object that would hold it. */
  scopePath: string;
}

export type Rule = Exclude<
  Issue['rule'],
  'syntax' | 'yaml-feature' | 'schema' | 'P01' | 'P02' | 'comment'
>;

/** `inner` may exist only where `outer` does. */
export const scopeFits = (inner: string, outer: string) =>
  outer === 'both' || inner === outer;

/**
 * The indexes the rules share, each built once on first use so that every
 * lookup is a map lookup: an entity's attributes and keys by id, its primary
 * key, and which of its attributes each link and parent attribute migrate to.
 */
export class RuleContext {
  readonly issues: Issue[] = [];
  readonly entities = new Map<string, Entity>();
  readonly links = new Map<string, Link>();

  private readonly attributeIndex = new WeakMap<
    Entity,
    Map<string, Attribute>
  >();
  private readonly keyIndex = new WeakMap<Entity, Map<string, Key>>();
  private readonly primaryIndex = new WeakMap<Entity, Key | null>();
  private readonly keyAttributeIndex = new WeakMap<Key, Set<string>>();
  private readonly targetIndex = new WeakMap<
    Entity,
    Map<string, Map<string, string[]>>
  >();

  report(rule: Rule, file: string, path: string, message: string): void {
    this.issues.push({ rule, severity: 'error', file, path, message });
  }

  /** The first attribute of the entity with this id. */
  attribute(entity: Entity, id: string): Attribute | undefined {
    let index = this.attributeIndex.get(entity);
    if (!index) {
      index = new Map();
      for (const attribute of entity.attributes) {
        if (!index.has(attribute.id)) index.set(attribute.id, attribute);
      }
      this.attributeIndex.set(entity, index);
    }
    return index.get(id);
  }

  /** The first key of the entity with this id. */
  key(entity: Entity, id: string): Key | undefined {
    let index = this.keyIndex.get(entity);
    if (!index) {
      index = new Map();
      for (const key of entity.keys) {
        if (!index.has(key.id)) index.set(key.id, key);
      }
      this.keyIndex.set(entity, index);
    }
    return index.get(id);
  }

  /** The entity's first primary key. */
  primaryKey(entity: Entity): Key | undefined {
    let primary = this.primaryIndex.get(entity);
    if (primary === undefined) {
      primary = entity.keys.find((key) => key.kind === 'primary') ?? null;
      this.primaryIndex.set(entity, primary);
    }
    return primary ?? undefined;
  }

  /** The key a link migrates: the one `parentKey` names, else the parent's primary key. */
  migratedKey(link: Link, parent: Entity): Key | undefined {
    return link.parentKey === undefined
      ? this.primaryKey(parent)
      : this.key(parent, link.parentKey);
  }

  keyAttributes(key: Key): Set<string> {
    let attributes = this.keyAttributeIndex.get(key);
    if (!attributes) {
      attributes = new Set(key.attributes.map((entry) => entry.value));
      this.keyAttributeIndex.set(key, attributes);
    }
    return attributes;
  }

  /**
   * The ids of the child's attributes that name `link` and `parentAttribute`
   * in `migratedFrom`, in attribute order; an attribute that names the pair
   * twice counts once.
   */
  targets(child: Entity, link: string, parentAttribute: string): string[] {
    let index = this.targetIndex.get(child);
    if (!index) {
      index = new Map();
      for (const attribute of child.attributes) {
        const named = new Set<string>();
        for (const from of attribute.migratedFrom) {
          const pair = JSON.stringify([from.relationship, from.attribute]);
          if (named.has(pair)) continue;
          named.add(pair);
          let byAttribute = index.get(from.relationship);
          if (!byAttribute) {
            byAttribute = new Map();
            index.set(from.relationship, byAttribute);
          }
          const ids = byAttribute.get(from.attribute);
          if (ids) ids.push(attribute.id);
          else byAttribute.set(from.attribute, [attribute.id]);
        }
      }
      this.targetIndex.set(child, index);
    }
    return index.get(link)?.get(parentAttribute) ?? [];
  }
}
