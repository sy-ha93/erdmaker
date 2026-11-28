import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';
import { dictionaryFolders } from '../command/paths.js';
import { createEditor } from '../command/editor.js';
import { joinPath } from '../fs/path.js';
import { recordingFileSystem } from '../testing/recording-fs.js';
import { dictionaryEntries } from './dictionary-entries.js';
import { loadModel } from './load.js';

const FIXED = [
  'entities',
  'relationships',
  'subtypes',
  'subject-areas',
  'layouts',
];

/** The dictionary folders `loadModel` lists in `m` for this `model.yaml`. */
async function loaderFolders(manifest: string): Promise<string[]> {
  const fs = recordingFileSystem({ 'm/model.yaml': manifest });
  await loadModel(fs, 'm');
  const listed = fs.paths('list');
  // Each of the five fixed folders is listed once, after the dictionaries.
  for (const folder of FIXED) {
    listed.splice(listed.lastIndexOf(joinPath('m', folder)), 1);
  }
  return listed;
}

const VALID = 'formatVersion: "0.1"\nid: m\nname: M\n';

/** `model.yaml` texts, and what the in-memory manifest holds for each. */
const CASES: [string, string][] = [
  ['no dictionaries', VALID],
  ['a list', `${VALID}dictionaries: [entities]\n`],
  ['two folders', `${VALID}dictionaries: [shared, entities]\n`],
  ['an empty list', `${VALID}dictionaries: []\n`],
  ['an absolute entry', `${VALID}dictionaries: [/abs, sub/dict]\n`],
  ['a number', `${VALID}dictionaries: 42\n`],
  ['a list with a number', `${VALID}dictionaries: [entities, 42]\n`],
  ['a list with an empty entry', `${VALID}dictionaries: [entities, ""]\n`],
  [
    'another schema error',
    'formatVersion: "0.1"\nid: m\ndictionaries: [entities]\n',
  ],
  ['an unknown key', `${VALID}dictionaries: [entities]\nextra: 1\n`],
];

describe('사전 폴더: 읽기와 편집기가 같은 규칙', () => {
  test.each(CASES)(
    '%s: loadModel and the editor take the same folders',
    async (_name, text) => {
      const data: unknown = parse(text);
      const loaded = await loaderFolders(text);
      expect(
        dictionaryEntries(data).map((entry) => joinPath('m', entry)),
      ).toEqual([...new Set(loaded)]);
      expect(dictionaryFolders('m', { file: 'm/model.yaml', data })).toEqual(
        loaded,
      );
    },
  );

  test('a model.yaml that does not parse, and no manifest at all, give the default folder', async () => {
    expect(await loaderFolders('dictionaries: [entities\n')).toEqual([
      'm/dictionary',
    ]);
    expect(dictionaryEntries(undefined)).toEqual(['dictionary']);
    expect(dictionaryFolders('m', undefined)).toEqual(['m/dictionary']);
  });

  test('what the loader reads is what the editor refuses to create in', () => {
    const data = parse(`${VALID}dictionaries: [entities]\n`) as unknown;
    const editor = createEditor({
      dir: '',
      manifest: { file: 'model.yaml', data } as never,
      entities: [],
      relationships: [],
      subtypes: [],
      subjectAreas: [],
      layouts: [],
      dictionaries: [],
    });
    expect(
      editor.execute({ type: 'entity.create', name: 'Customer' }),
    ).toMatchObject({
      ok: false,
      code: 'id-taken',
    });
    // Mixed entries: the loader leaves such a manifest out and reads `dictionary`.
    const mixed = parse(`${VALID}dictionaries: [entities, 42]\n`) as unknown;
    const other = createEditor({
      dir: '',
      manifest: { file: 'model.yaml', data: mixed } as never,
      entities: [],
      relationships: [],
      subtypes: [],
      subjectAreas: [],
      layouts: [],
      dictionaries: [],
    });
    expect(
      other.execute({ type: 'entity.create', name: 'Customer' }),
    ).toMatchObject({
      ok: true,
      id: 'customer',
    });
  });

  test('never throws, and reads no getter', () => {
    let called = 0;
    const getter = {
      formatVersion: '0.1',
      id: 'm',
      name: 'M',
      get dictionaries() {
        called += 1;
        return ['entities'];
      },
    };
    const throwing = new Proxy(
      {},
      {
        get() {
          throw new Error('boom');
        },
        getOwnPropertyDescriptor() {
          throw new Error('boom');
        },
        ownKeys() {
          throw new Error('boom');
        },
        getPrototypeOf() {
          throw new Error('boom');
        },
      },
    );
    for (const data of [getter, throwing, null, 42, 'x', [], () => 1]) {
      expect(dictionaryEntries(data)).toEqual(['dictionary']);
    }
    expect(called).toBe(0);
  });
});
