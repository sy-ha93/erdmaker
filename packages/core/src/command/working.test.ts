import { describe, expect, test } from 'vitest';
import type { EntityData, LayoutData, ReadonlyModel } from '../model/types.js';
import {
  areaItem,
  deepFreeze,
  entityItem,
  handModel,
} from '../testing/editing.js';
import { deleteEntity, updateEntity } from './handlers/entity.js';
import { InitialPaths } from './paths.js';
import { Working } from './working.js';

const working = (model: ReadonlyModel) =>
  new Working(model, {
    initial: new InitialPaths([]),
    reservedKeys: new Set(),
    dictionaryFolders: [],
  });

describe('작업 상태', () => {
  test('an owned entity has its own physical, attributes and keys, whoever owned it first', () => {
    const start = deepFreeze(
      handModel({
        entities: [
          entityItem('e', {
            physical: { name: 'E' },
            attributes: [{ id: 'a', name: 'A' }],
            keys: [{ id: 'pk', kind: 'primary', attributes: ['a'] }],
          }),
        ],
      }),
    );
    const state = working(start);
    expect(
      updateEntity(
        { type: 'entity.update', id: 'e', set: { note: 'n' } },
        state,
      ).ok,
    ).toBe(true);
    const owned = state.item<EntityData>('entities', 0).data;
    const was = start.entities[0]!.data;
    expect(owned).not.toBe(was);
    expect(owned.physical).not.toBe(was.physical);
    expect(owned.attributes).not.toBe(was.attributes);
    expect(owned.keys).not.toBe(was.keys);
    expect(owned.attributes).toEqual(was.attributes);
    expect(owned.keys).toEqual(was.keys);
  });

  test('an owned subject area and layout have their own entities and nodes', () => {
    const layout = {
      file: 'layouts/s.json',
      data: {
        formatVersion: '0.1' as const,
        subjectArea: 's',
        nodes: { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
        edges: {},
      },
    };
    const start = deepFreeze(
      handModel({
        entities: [entityItem('a'), entityItem('b')],
        subjectAreas: [areaItem('s', ['a', 'b'])],
        layouts: [layout],
      }),
    );
    const state = working(start);
    expect(deleteEntity({ type: 'entity.delete', id: 'a' }, state).ok).toBe(
      true,
    );
    const area = state.item<{ entities: string[] }>('subjectAreas', 0).data;
    expect(area.entities).toEqual(['b']);
    expect(start.subjectAreas[0]!.data.entities).toEqual(['a', 'b']);
    const nodes = state.item<LayoutData>('layouts', 0).data.nodes;
    expect(Object.keys(nodes)).toEqual(['b']);
    expect(Object.keys(start.layouts[0]!.data.nodes)).toEqual(['a', 'b']);
  });
});
