import type {
  EntityData,
  Model,
  ModelItem,
  SubjectAreaData,
} from '../model/types.js';

/**
 * A model of `entities` entities `e0`, `e1`, … with `attributes` attributes
 * `a0`, `a1`, … each, and one subject area `all` that lists every entity
 * (spec FR-10, the regression guard). The test checks it has no issues.
 */
export function wideModel(entities: number, attributes: number): Model {
  const ids = Array.from({ length: entities }, (_, e) => `e${e}`);
  const entityItems: ModelItem<EntityData>[] = ids.map((id) => ({
    file: `entities/${id}.yaml`,
    data: {
      id,
      name: id.toUpperCase(),
      attributes: Array.from({ length: attributes }, (_, a) => ({
        id: `a${a}`,
        name: `A${a}`,
        type: { base: 'string', length: 40 },
      })),
    },
  }));
  const area: ModelItem<SubjectAreaData> = {
    file: 'subject-areas/all.yaml',
    data: { id: 'all', name: 'All', entities: [...ids].sort() },
  };
  return {
    dir: '',
    manifest: {
      file: 'model.yaml',
      data: { formatVersion: '0.1', id: 'wide', name: 'Wide' },
    },
    entities: entityItems,
    relationships: [],
    subtypes: [],
    subjectAreas: [area],
    layouts: [],
    dictionaries: [],
  };
}
