import { describe, expect, test } from 'vitest';
import { createMemoryFileSystem } from '../fs/memory.js';
import type { Issue } from '../model/types.js';
import { exampleFiles, type Files, replaceOnce } from '../testing/example.js';
import { findModels } from './find.js';
import { type ModelCounts, validateProject } from './validate.js';

/** `files` moved into the folder `dir`. */
function under(dir: string, files: Files): Files {
  return Object.fromEntries(
    Object.entries(files).map(([path, text]) => [`${dir}/${path}`, text]),
  );
}

/** The example with its model `id` replaced. */
const withId = (id: string, files: Files = exampleFiles()) =>
  replaceOnce(files, 'model.yaml', 'id: shop\n', `id: ${id}\n`);

/** The example without its dictionary folder, which reads `../dictionary` instead. */
function sharingDictionary(id: string): Files {
  const files = withId(id);
  delete files['dictionary/standard.yaml'];
  return replaceOnce(
    files,
    'model.yaml',
    'targets:\n',
    'dictionaries:\n  - ../dictionary\ntargets:\n',
  );
}

const MODEL = 'formatVersion: "0.1"\nid: m\nname: m\n';

const EXAMPLE_COUNTS: ModelCounts = {
  entities: 10,
  relationships: 11,
  subtypes: 1,
  subjectAreas: 3,
  layouts: 2,
  words: 5,
  terms: 4,
  domains: 8,
};

const p01 = (file: string, message: string): Issue => ({
  rule: 'P01',
  severity: 'error',
  file,
  path: '/id',
  line: 2,
  column: 1,
  message,
});

const p02 = (file: string, message: string): Issue => ({
  rule: 'P02',
  severity: 'error',
  file,
  path: '',
  line: 1,
  column: 1,
  message,
});

describe('모델 찾기', () => {
  test('a model at depth 3 is found, one at depth 4 is not', async () => {
    const fs = createMemoryFileSystem({
      'a/b/c/model.yaml': MODEL,
      'p/q/r/s/model.yaml': MODEL,
    });
    expect(await findModels(fs, '')).toEqual({
      models: ['a/b/c'],
      issues: [],
    });
  });

  test('the opened folder itself is depth 0', async () => {
    const fs = createMemoryFileSystem({ 'model.yaml': MODEL });
    expect(await findModels(fs, '')).toEqual({ models: [''], issues: [] });
  });

  test('depth counts from the folder given, and paths stay relative to the opened folder', async () => {
    const fs = createMemoryFileSystem({
      'p/a/b/c/model.yaml': MODEL,
      'p/a/b/c/d/model.yaml': MODEL,
      'q/model.yaml': MODEL,
    });
    expect(await findModels(fs, 'p')).toEqual({
      models: ['p/a/b/c'],
      issues: [],
    });
    expect(await findModels(fs, './p/../p/')).toEqual({
      models: ['p/a/b/c'],
      issues: [],
    });
  });

  test('folders whose names start with "." and node_modules are not entered', async () => {
    const fs = createMemoryFileSystem({
      '.hidden/model.yaml': MODEL,
      'a/.git/model.yaml': MODEL,
      'node_modules/m/model.yaml': MODEL,
      'a/node_modules/model.yaml': MODEL,
      'b/.model/x.yaml': MODEL,
      'b/model.yaml': MODEL,
    });
    expect(await findModels(fs, '')).toEqual({ models: ['b'], issues: [] });
  });

  test('models come in path order (code units), and a folder named model.yaml is no model', async () => {
    const fs = createMemoryFileSystem({
      'b/model.yaml': MODEL,
      'a/x/model.yaml': MODEL,
      'a-b/model.yaml': MODEL,
      'B/model.yaml': MODEL,
      'c/model.yaml/x.yaml': MODEL,
    });
    expect(await findModels(fs, '')).toEqual({
      models: ['B', 'a-b', 'a/x', 'b'],
      issues: [],
    });
  });

  test('a model inside a model is no model but P02 at the inner model.yaml', async () => {
    const fs = createMemoryFileSystem({
      'm/model.yaml': MODEL,
      'm/inner/model.yaml': MODEL,
      'm/inner/deeper/model.yaml': MODEL,
      'n/model.yaml': MODEL,
    });
    expect(await findModels(fs, '')).toEqual({
      models: ['m', 'n'],
      issues: [
        p02(
          'm/inner/deeper/model.yaml',
          'model.yaml inside another model (m/model.yaml)',
        ),
        p02(
          'm/inner/model.yaml',
          'model.yaml inside another model (m/model.yaml)',
        ),
      ],
    });
  });

  test('every model.yaml below an opened model folder is P02, within the depth limit only', async () => {
    const fs = createMemoryFileSystem({
      'model.yaml': MODEL,
      'a/model.yaml': MODEL,
      'a/b/c/model.yaml': MODEL,
      'a/b/c/d/model.yaml': MODEL,
    });
    expect(await findModels(fs, '')).toEqual({
      models: [''],
      issues: [
        p02('a/b/c/model.yaml', 'model.yaml inside another model (model.yaml)'),
        p02('a/model.yaml', 'model.yaml inside another model (model.yaml)'),
      ],
    });
  });

  test('a folder without models gives no models and no issues', async () => {
    const fs = createMemoryFileSystem({ 'a/b.yaml': MODEL });
    expect(await findModels(fs, '')).toEqual({ models: [], issues: [] });
    expect(await findModels(fs, 'missing')).toEqual({
      models: [],
      issues: [],
    });
  });

  test('validateProject: the example alone has no issues and its counts', async () => {
    const fs = createMemoryFileSystem(exampleFiles());
    expect(await validateProject(fs, '')).toEqual({
      issues: [],
      models: [{ dir: '', issues: [], counts: EXAMPLE_COUNTS }],
    });
  });

  test('validateProject: two models with the same id give P01 at each model.yaml, not in the models', async () => {
    const fs = createMemoryFileSystem({
      ...under('a', exampleFiles()),
      ...under('b', exampleFiles()),
      ...under('c', withId('other')),
    });
    expect(await validateProject(fs, '')).toEqual({
      issues: [
        p01('a/model.yaml', 'duplicate model id "shop" (also in b/model.yaml)'),
        p01('b/model.yaml', 'duplicate model id "shop" (also in a/model.yaml)'),
      ],
      models: [
        { dir: 'a', issues: [], counts: EXAMPLE_COUNTS },
        { dir: 'b', issues: [], counts: EXAMPLE_COUNTS },
        { dir: 'c', issues: [], counts: EXAMPLE_COUNTS },
      ],
    });
  });

  test('validateProject: with three alike, the first names the second and the others name the first', async () => {
    const fs = createMemoryFileSystem({
      ...under('x/a', exampleFiles()),
      ...under('x/b', exampleFiles()),
      ...under('x/c', exampleFiles()),
    });
    const result = await validateProject(fs, 'x');
    expect(result.issues).toEqual([
      p01(
        'x/a/model.yaml',
        'duplicate model id "shop" (also in x/b/model.yaml)',
      ),
      p01(
        'x/b/model.yaml',
        'duplicate model id "shop" (also in x/a/model.yaml)',
      ),
      p01(
        'x/c/model.yaml',
        'duplicate model id "shop" (also in x/a/model.yaml)',
      ),
    ]);
    expect(result.models.map((model) => model.dir)).toEqual([
      'x/a',
      'x/b',
      'x/c',
    ]);
  });

  test('validateProject: a model whose model.yaml is not read is left out of the id comparison', async () => {
    const broken = replaceOnce(
      exampleFiles(),
      'model.yaml',
      'name: 쇼핑몰\n',
      '',
    );
    const fs = createMemoryFileSystem({
      ...under('a', exampleFiles()),
      ...under('b', broken),
    });
    const result = await validateProject(fs, '');
    expect(result.issues).toEqual([]);
    expect(result.models[1]?.issues).toEqual<Issue[]>([
      {
        rule: 'schema',
        severity: 'error',
        file: 'b/model.yaml',
        path: '',
        line: 1,
        column: 1,
        message: "/ must have required property 'name'",
      },
      // Without the manifest the area groups are unknown.
      ...(
        [
          ['catalog', 'master'],
          ['party', 'master'],
          ['sales', 'trade'],
        ] as const
      ).map(([area, group]): Issue => ({
        rule: 'R12',
        severity: 'error',
        file: `b/subject-areas/${area}.yaml`,
        path: '/group',
        line: 3,
        column: 1,
        message: `unknown area group "${group}"`,
      })),
    ]);
  });

  test('validateProject: P02 comes with the project issues, and the models are still checked', async () => {
    const fs = createMemoryFileSystem({
      ...under('m', exampleFiles()),
      'm/inner/model.yaml': MODEL,
    });
    expect(await validateProject(fs, '')).toEqual({
      issues: [
        p02(
          'm/inner/model.yaml',
          'model.yaml inside another model (m/model.yaml)',
        ),
      ],
      models: [{ dir: 'm', issues: [], counts: EXAMPLE_COUNTS }],
    });
  });

  test('validateProject: two models sharing ../dictionary have no issues', async () => {
    const fs = createMemoryFileSystem({
      ...under('a', sharingDictionary('a')),
      ...under('b', sharingDictionary('b')),
      'dictionary/standard.yaml':
        exampleFiles()['dictionary/standard.yaml'] ?? '',
    });
    expect(await validateProject(fs, '')).toEqual({
      issues: [],
      models: [
        { dir: 'a', issues: [], counts: EXAMPLE_COUNTS },
        { dir: 'b', issues: [], counts: EXAMPLE_COUNTS },
      ],
    });
  });

  test('validateProject: an error of a shared dictionary is reported for each model', async () => {
    const dictionary = replaceOnce(
      exampleFiles(),
      'dictionary/standard.yaml',
      '      - nm\n',
      '      - nmx\n',
    )['dictionary/standard.yaml'];
    const fs = createMemoryFileSystem({
      ...under('a', sharingDictionary('a')),
      ...under('b', sharingDictionary('b')),
      'dictionary/standard.yaml': dictionary ?? '',
    });
    const result = await validateProject(fs, '');
    expect(result.issues).toEqual([]);
    const issue: Issue = {
      rule: 'R02',
      severity: 'error',
      file: 'dictionary/standard.yaml',
      path: '/terms/1/words/1',
      line: 41,
      column: 9,
      message: 'term "cust_nm": unknown word "nmx"',
    };
    expect(result.models.map((model) => [model.dir, model.issues])).toEqual([
      ['a', [issue]],
      ['b', [issue]],
    ]);
  });

  test('validateProject: a folder without models gives nothing', async () => {
    const fs = createMemoryFileSystem({ 'a.yaml': MODEL });
    expect(await validateProject(fs, '')).toEqual({ issues: [], models: [] });
  });
});
