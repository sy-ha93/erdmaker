import { describe, expect, test } from 'vitest';
import { exampleFileSystem } from '../testing/example.js';
import { validateModel } from '../validate/index.js';
import { loadModel } from './load.js';
import { serializeModel } from './serialize.js';
import type { Model, ReadonlyModel } from './types.js';
import { writeModel } from './write.js';

/**
 * Writes that the type of a `ReadonlyModel` refuses. Never called: each line
 * would change the model, and `pnpm lint` checks that each is a type error.
 */
function mutations(model: ReadonlyModel): void {
  const entity = model.entities[0]!;
  // @ts-expect-error A field of an item's data is read-only.
  entity.data.name = 'Renamed';
  // @ts-expect-error A list of the model is read-only.
  model.entities.push(entity);
  const inner = entity.data.ext?.['inner'];
  if (typeof inner === 'object' && inner !== null && !Array.isArray(inner)) {
    const map = inner as Exclude<typeof inner, readonly unknown[]>;
    // @ts-expect-error What `ext` holds is read-only too.
    map['key'] = 1;
  }
}

describe('읽기 전용 모델', () => {
  test('a Model is a ReadonlyModel', async () => {
    const { model } = await loadModel(exampleFileSystem(), '');
    const readonly: ReadonlyModel = model;
    expect(readonly).toBe(model);
    expect(typeof mutations).toBe('function');
  });

  test('validateModel, serializeModel and writeModel take a ReadonlyModel and do as with a Model', async () => {
    const { model } = await loadModel(exampleFileSystem(), '');
    const readonly: ReadonlyModel = (await loadModel(exampleFileSystem(), ''))
      .model;
    const asModel: Model = model;
    expect(validateModel(readonly)).toEqual(validateModel(asModel));
    expect(serializeModel(readonly)).toEqual(serializeModel(asModel));
    // A file the model does not hold yet, so both saves write something.
    const added: ReadonlyModel = {
      ...readonly,
      entities: [
        ...readonly.entities,
        {
          file: 'entities/added.yaml',
          data: { id: 'added', name: 'Added', attributes: [] },
        },
      ],
    };
    const addedModel: Model = {
      ...asModel,
      entities: [
        ...asModel.entities,
        {
          file: 'entities/added.yaml',
          data: { id: 'added', name: 'Added', attributes: [] },
        },
      ],
    };
    const written = await writeModel(exampleFileSystem(), added);
    expect(written).toEqual(await writeModel(exampleFileSystem(), addedModel));
    expect(written).toContain('entities/added.yaml');
  });
});
