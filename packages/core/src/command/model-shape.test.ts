import { describe, expect, test } from 'vitest';
import { loadModel } from '../model/load.js';
import { validateModel } from '../validate/index.js';
import { exampleFileSystem } from '../testing/example.js';
import { checkEditable, readModelShape } from './model-shape.js';

const LISTS = [
  'entities',
  'relationships',
  'subtypes',
  'subjectAreas',
  'layouts',
  'dictionaries',
] as const;

type Shape = Record<string, unknown>;

const model = (partial: Shape = {}): Shape => ({
  dir: '',
  entities: [],
  relationships: [],
  subtypes: [],
  subjectAreas: [],
  layouts: [],
  dictionaries: [],
  ...partial,
});

const entity = (file: string, id = 'a') => ({
  file,
  data: { id, name: id, attributes: [] },
});

const dictionary = (file: string) => ({ file, data: {} });

describe('편집기 만들기: 모델의 조건', () => {
  test('the nine inputs of AC-14 give the reasons of FR-01', () => {
    const cases: [unknown, string][] = [
      [null, 'it is not an object'],
      [model({ dir: 'a//b' }), 'dir is not a normalized path'],
      [model({ entities: {} }), 'entities is not a list'],
      [model({ entities: [1] }), 'entities[0] is not an item'],
      [
        model({ entities: [entity('entities//a.yaml')] }),
        'entities//a.yaml is not a normalized file path',
      ],
      [
        model({ dictionaries: [dictionary('.')] }),
        '. is not a normalized file path',
      ],
      [
        model({
          dir: 'billing',
          entities: [entity('billing-old/entities/a.yaml')],
        }),
        'billing-old/entities/a.yaml is outside the model folder',
      ],
      [
        model({
          entities: [entity('entities/a.yaml'), entity('entities/a.yaml', 'b')],
        }),
        'entities/a.yaml is used by two items',
      ],
      [
        model({
          dictionaries: [
            dictionary('../dictionary/a.yaml'),
            dictionary('../dictionary/a.yaml'),
          ],
        }),
        '../dictionary/a.yaml is used by two items',
      ],
    ];
    for (const [input, reason] of cases) {
      expect(checkEditable(input)).toBe(reason);
    }
  });

  test('accepts a dictionary outside the folder, a broken model, no manifest', async () => {
    expect(
      checkEditable(
        model({
          dir: 'm',
          dictionaries: [dictionary('../dictionary/a.yaml')],
        }),
      ),
    ).toBeUndefined();

    const broken = model({
      entities: [entity('entities/a.yaml'), entity('entities/b.yaml')],
    });
    expect(validateModel(broken as never).length).toBeGreaterThan(0);
    expect(checkEditable(broken)).toBeUndefined();

    const { model: example } = await loadModel(exampleFileSystem(), '');
    expect(checkEditable(example)).toBeUndefined();
    const withoutManifest = { ...example, manifest: undefined };
    expect(checkEditable(withoutManifest)).toBeUndefined();
  });

  test('condition 1: not an object, and a dir that is not normalized', () => {
    for (const input of [undefined, 1, 'x', true, () => model()]) {
      expect(checkEditable(input)).toBe('it is not an object');
    }
    for (const dir of [undefined, 1, null, 'a/', './a', 'a/../b', '/a']) {
      expect(checkEditable(model({ dir }))).toBe(
        'dir is not a normalized path',
      );
    }
    for (const dir of ['', 'a', 'a/b', '..', '../m']) {
      expect(checkEditable(model({ dir }))).toBeUndefined();
    }
  });

  test('condition 2: every list is a list, then every item is an item', () => {
    for (const list of LISTS) {
      expect(checkEditable(model({ [list]: undefined }))).toBe(
        `${list} is not a list`,
      );
      expect(checkEditable(model({ [list]: [{ file: 1 }] }))).toBe(
        `${list}[0] is not an item`,
      );
    }
    expect(checkEditable(model({ entities: [entity('e/a.yaml'), null] }))).toBe(
      'entities[1] is not an item',
    );
    expect(checkEditable(model({ manifest: { data: {} } }))).toBe(
      'manifest is not an item',
    );
    expect(checkEditable(model({ manifest: null }))).toBe(
      'manifest is not an item',
    );
    // Lists before items, whatever list comes first.
    expect(checkEditable(model({ entities: [1], dictionaries: 'x' }))).toBe(
      'dictionaries is not a list',
    );
    // In list order.
    expect(checkEditable(model({ relationships: [1], layouts: [1] }))).toBe(
      'relationships[0] is not an item',
    );
  });

  test('condition 3: normalized and not empty, then no file twice', () => {
    expect(checkEditable(model({ entities: [entity('')] }))).toBe(
      ' is not a normalized file path',
    );
    expect(checkEditable(model({ manifest: { file: './model.yaml' } }))).toBe(
      './model.yaml is not a normalized file path',
    );
    // A manifest and an entity on one file.
    expect(
      checkEditable(
        model({
          manifest: { file: 'model.yaml' },
          entities: [entity('model.yaml')],
        }),
      ),
    ).toBe('model.yaml is used by two items');
    // Files of different lists.
    expect(
      checkEditable(
        model({
          entities: [entity('x.yaml')],
          layouts: [{ file: 'x.yaml', data: {} }],
        }),
      ),
    ).toBe('x.yaml is used by two items');
    // Normalization is checked over every item before the files are compared.
    expect(
      checkEditable(
        model({
          entities: [entity('a.yaml'), entity('a.yaml', 'b')],
          dictionaries: [dictionary('d//x.yaml')],
        }),
      ),
    ).toBe('d//x.yaml is not a normalized file path');
    // Letter case alone does not make two files one here (FR-09 looks at it).
    expect(
      checkEditable(
        model({ entities: [entity('A.yaml'), entity('a.yaml', 'b')] }),
      ),
    ).toBeUndefined();
  });

  test('condition 4: the five lists inside dir by component, dictionaries free', () => {
    const outside = (dir: string, file: string) =>
      checkEditable(model({ dir, entities: [entity(file)] }));
    expect(outside('', '../a.yaml')).toBe(
      '../a.yaml is outside the model folder',
    );
    expect(outside('', '..')).toBe('.. is outside the model folder');
    expect(outside('m', 'm')).toBe('m is outside the model folder');
    expect(outside('m', 'mm/a.yaml')).toBe(
      'mm/a.yaml is outside the model folder',
    );
    expect(outside('m/n', 'm/a.yaml')).toBe(
      'm/a.yaml is outside the model folder',
    );
    expect(outside('', 'a.yaml')).toBeUndefined();
    expect(outside('m', 'm/a.yaml')).toBeUndefined();
    expect(outside('..', '../a.yaml')).toBeUndefined();
    expect(outside('../m', '../m/e/a.yaml')).toBeUndefined();
    for (const list of [
      'relationships',
      'subtypes',
      'subjectAreas',
      'layouts',
    ]) {
      expect(
        checkEditable(
          model({ dir: 'm', [list]: [{ file: 'n/a.yaml', data: {} }] }),
        ),
      ).toBe('n/a.yaml is outside the model folder');
    }
    expect(
      checkEditable(model({ dir: 'm', manifest: { file: 'model.yaml' } })),
    ).toBeUndefined();
    // Condition 3 comes first.
    expect(
      checkEditable(
        model({
          dir: 'm',
          entities: [entity('x/a.yaml')],
          dictionaries: [dictionary('a//b')],
        }),
      ),
    ).toBe('a//b is not a normalized file path');
  });

  test('a getter or trap that throws fails the condition of that place', () => {
    const throwing = (key: string, value: Shape): Shape =>
      Object.defineProperty({ ...value }, key, {
        get() {
          throw new Error('no');
        },
        enumerable: true,
      });
    expect(checkEditable(throwing('dir', model()))).toBe(
      'dir is not a normalized path',
    );
    expect(checkEditable(throwing('layouts', model()))).toBe(
      'layouts is not a list',
    );
    expect(checkEditable(throwing('manifest', model()))).toBe(
      'manifest is not an item',
    );
    const item = throwing('file', { data: {} });
    expect(checkEditable(model({ subtypes: [item] }))).toBe(
      'subtypes[0] is not an item',
    );
    const list = Object.defineProperty([], 0, {
      get() {
        throw new Error('no');
      },
    });
    expect(checkEditable(model({ entities: list }))).toBe(
      'entities[0] is not an item',
    );
    const badLength = new Proxy([], {
      get(target, key) {
        if (key === 'length') throw new Error('no');
        return Reflect.get(target, key);
      },
    });
    expect(checkEditable(model({ entities: badLength }))).toBe(
      'entities is not a list',
    );
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    // An object whose every read throws: its first place is `dir`.
    expect(checkEditable(proxy)).toBe('dir is not a normalized path');
    const revokedList = Proxy.revocable([], {});
    revokedList.revoke();
    expect(checkEditable(model({ entities: revokedList.proxy }))).toBe(
      'entities is not a list',
    );
    const revokedItem = Proxy.revocable({ file: 'a.yaml' }, {});
    revokedItem.revoke();
    expect(checkEditable(model({ entities: [revokedItem.proxy] }))).toBe(
      'entities[0] is not an item',
    );
  });

  test('reads every place once and keeps what it read', () => {
    let reads = 0;
    const item = {
      data: {},
      get file() {
        reads += 1;
        return reads === 1 ? 'entities/a.yaml' : 'entities//b.yaml';
      },
    };
    let dirReads = 0;
    const input = {
      ...model({ entities: [item] }),
      get dir() {
        dirReads += 1;
        return dirReads === 1 ? '' : 'a//b';
      },
    };
    const read = readModelShape(input);
    expect(read).toEqual({
      shape: {
        dir: '',
        manifest: undefined,
        items: [{ list: 'entities', index: 0, file: 'entities/a.yaml', item }],
        dictionaries: [],
      },
    });
    expect(reads).toBe(1);
    expect(dirReads).toBe(1);
    if ('shape' in read) expect(read.shape.items[0]!.item).toBe(item);
  });

  test('a large model is checked in one pass', () => {
    const entities = [];
    for (let i = 0; i < 100_000; i += 1) entities.push(entity(`e/${i}.yaml`));
    expect(checkEditable(model({ entities }))).toBeUndefined();
    entities.push(entity('e/0.yaml'));
    expect(checkEditable(model({ entities }))).toBe(
      'e/0.yaml is used by two items',
    );
  });
});
