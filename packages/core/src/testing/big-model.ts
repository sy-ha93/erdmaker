import type { EntityData, Model, ModelItem } from '../model/types.js';

/** How much of each kind of thing `bigModel` makes. */
export interface Sizes {
  /** Attributes of the parent and of the child the one relationship migrates them to. */
  wide: number;
  /** Children of the hub, each through its own relationship, and subtype members. */
  many: number;
  /** Words and terms. */
  terms: number;
}

/**
 * A valid model: a parent and a child entity with `wide` attributes
 * migrated through one relationship (a key of `wide` attributes), `many`
 * entities each the child of its own relationship from one hub, `many`
 * subtype members, a dictionary of `terms` words and terms, a subject area
 * listing every entity and a layout with every node and edge. `broken`
 * makes every migration wrong.
 */
export function bigModel(sizes: Sizes, broken = false): Model {
  const range = (length: number) => Array.from({ length }, (_, i) => i);
  // Typed as any list's item: the shapes below are checked by the test, not by the compiler.
  const item = (file: string, data: unknown): ModelItem<never> => ({
    file,
    data: data as never,
  });
  const wide = range(sizes.wide).map((i) => `a${i}`);
  const entities: ModelItem<EntityData>[] = [
    item('entities/p.yaml', {
      id: 'p',
      name: 'P',
      attributes: wide.map((id, i) => ({
        id,
        name: id,
        domain: 'num',
        ...(i < sizes.terms ? { term: `t${i}` } : {}),
      })),
      keys: [{ id: 'pk', kind: 'primary', attributes: wide }],
    }),
    item('entities/c.yaml', {
      id: 'c',
      name: 'C',
      attributes: wide.map((id) => ({
        id,
        name: broken ? `${id}x` : id,
        domain: 'num',
        migratedFrom: [
          { relationship: 'wide', attribute: broken ? `b${id}` : id },
        ],
      })),
      keys: [{ id: 'pk', kind: 'primary', attributes: wide }],
    }),
    item('entities/h.yaml', {
      id: 'h',
      name: 'H',
      attributes: [{ id: 'h_id', name: 'H', domain: 'num' }],
      keys: [{ id: 'pk', kind: 'primary', attributes: ['h_id'] }],
    }),
  ];
  const child = (prefix: string, link: string, i: number, inKey: boolean) =>
    item(`entities/${prefix}${i}.yaml`, {
      id: `${prefix}${i}`,
      name: `${prefix}${i}`,
      physical: { name: `${prefix.toUpperCase()}${i}`, schema: 'main' },
      attributes: [
        { id: 'own', name: 'Own', domain: 'num' },
        {
          id: 'h_id',
          name: broken ? 'Other' : 'H',
          domain: 'num',
          migratedFrom: [{ relationship: `${link}${i}`, attribute: 'h_id' }],
        },
      ],
      keys: [
        {
          id: 'pk',
          kind: 'primary',
          attributes: inKey ? ['h_id'] : ['own'],
        },
      ],
    });
  for (const i of range(sizes.many)) entities.push(child('e', 'r', i, false));
  for (const i of range(sizes.many)) entities.push(child('s', 'm', i, true));
  const ids = entities.map((entity) => entity.data.id);
  return {
    dir: '',
    manifest: item('model.yaml', {
      formatVersion: '0.1',
      id: 'big',
      name: 'Big',
      schemas: [{ name: 'main' }],
      areaGroups: [{ id: 'g', name: 'G' }],
    }),
    dictionaries: [
      item('dictionary/d.yaml', {
        words: range(sizes.terms).map((i) => ({ id: `w${i}`, name: `W${i}` })),
        terms: range(sizes.terms).map((i) => ({
          id: `t${i}`,
          name: `T${i}`,
          words: [`w${i}`],
          domain: 'num',
        })),
        domains: [{ id: 'num', name: 'Num', type: { base: 'integer' } }],
      }),
    ],
    entities,
    relationships: [
      item('relationships/wide.yaml', {
        id: 'wide',
        kind: 'identifying',
        parent: 'p',
        child: 'c',
      }),
      ...range(sizes.many).map((i) =>
        item(`relationships/r${i}.yaml`, {
          id: `r${i}`,
          kind: 'non-identifying',
          parent: 'h',
          child: `e${i}`,
        }),
      ),
    ],
    subtypes: [
      item('subtypes/st.yaml', {
        id: 'st',
        supertype: 'h',
        members: range(sizes.many).map((i) => ({
          id: `m${i}`,
          entity: `s${i}`,
        })),
      }),
    ],
    subjectAreas: [
      item('subject-areas/all.yaml', {
        id: 'all',
        name: 'All',
        group: 'g',
        entities: [...ids].sort(),
      }),
    ],
    layouts: [
      item('layouts/all.json', {
        formatVersion: '0.1',
        subjectArea: 'all',
        nodes: Object.fromEntries(ids.map((id, i) => [id, { x: i, y: 0 }])),
        edges: Object.fromEntries(range(sizes.many).map((i) => [`r${i}`, {}])),
      }),
    ],
  };
}

/**
 * The issues of `bigModel(sizes, true)`: per wide attribute R02 (no such
 * parent attribute) and R04 (found 0); per child of the hub and per member
 * entity R06 (name).
 */
export const brokenCount = ({ wide, many }: Sizes) => 2 * wide + 2 * many;
