import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { FileSystemAdapter } from '../fs/adapter.js';
import { createMemoryFileSystem } from '../fs/memory.js';
import { loadModel } from '../model/load.js';
import { serializeItem } from '../model/serialize-item.js';
import type { EntityData, Model, ModelItem } from '../model/types.js';
import { exampleFiles } from '../testing/example.js';
import {
  recordingFileSystem,
  type RecordingFileSystem,
} from '../testing/recording-fs.js';
import { writeChanges } from './write-changes.js';

vi.mock('../model/serialize-item.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../model/serialize-item.js')>();
  return { ...actual, serializeItem: vi.fn(actual.serializeItem) };
});

const MANIFEST = 'formatVersion: "0.1"\nid: m\nname: M\n';

const entity = (
  file: string,
  id: string,
  extra: Partial<EntityData> = {},
): ModelItem<EntityData> => ({
  file,
  data: { id, name: id, attributes: [], ...extra },
});

/** The text `writeChanges` writes for an entity item. */
const textOf = (item: ModelItem<EntityData>) =>
  serializeItem(item.file, item.data, 'entity');

const emptyModel = (partial: Partial<Model> = {}): Model => ({
  dir: '',
  entities: [],
  relationships: [],
  subtypes: [],
  subjectAreas: [],
  layouts: [],
  dictionaries: [],
  ...partial,
});

async function load(fs: FileSystemAdapter, dir = ''): Promise<Model> {
  return (await loadModel(fs, dir)).model;
}

/** Clears the record and the serializer spy: call right before `writeChanges`. */
function ready(fs: RecordingFileSystem): void {
  fs.clear();
  vi.mocked(serializeItem).mockClear();
}

const serialized = () =>
  vi.mocked(serializeItem).mock.calls.map(([file]) => file);

/** The `writeText` and `remove` calls, in order. */
const changes = (fs: RecordingFileSystem) =>
  fs.calls.filter((c) => c.op === 'writeText' || c.op === 'remove');

/** Every file of the adapter with its text, by path. */
async function snapshot(fs: FileSystemAdapter): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const pending = [''];
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    for (const entry of await fs.list(dir)) {
      const path = dir === '' ? entry.name : `${dir}/${entry.name}`;
      if (entry.kind === 'directory') pending.push(path);
      else out.set(path, await fs.readText(path));
    }
  }
  return out;
}

/** An inner adapter whose `list` gives entries in reverse code unit order. */
function reversedListing(files: Record<string, string>): FileSystemAdapter {
  const inner = createMemoryFileSystem(files);
  return { ...inner, list: async (dir) => (await inner.list(dir)).reverse() };
}

const occupied = (path: string) =>
  new Error(`Cannot save: ${path} already exists and is not part of the model`);

const letterCase = (a: string, b: string) =>
  new Error(`Cannot save: ${a} and ${b} differ only in letter case`);

beforeEach(() => {
  vi.mocked(serializeItem).mockClear();
});

describe('저장의 조건', () => {
  describe('the models', () => {
    test('different folders, a file that is not normalized, not an object: no adapter call', async () => {
      const fs = recordingFileSystem({ 'model.yaml': MANIFEST });
      const before = await load(fs);
      ready(fs);
      await expect(
        writeChanges(fs, before, { ...before, dir: 'm' }),
      ).rejects.toThrow(
        new TypeError('Cannot save: the two models have different folders'),
      );
      await expect(
        writeChanges(fs, before, {
          ...before,
          entities: [entity('entities//a.yaml', 'a')],
        }),
      ).rejects.toThrow(
        new TypeError(
          'Cannot save: entities//a.yaml is not a normalized file path',
        ),
      );
      await expect(writeChanges(fs, null as never, before)).rejects.toThrow(
        new TypeError('Cannot save: it is not an object'),
      );
      expect(fs.calls).toEqual([]);
      expect(serialized()).toEqual([]);
    });

    test('before is checked first, then after, then the folders', async () => {
      const fs = recordingFileSystem();
      const bad = emptyModel({ dir: 'a//b' });
      const outside = emptyModel({
        dir: 'm',
        entities: [entity('x/a.yaml', 'a')],
      });
      await expect(writeChanges(fs, bad, outside)).rejects.toThrow(
        new TypeError('Cannot save: dir is not a normalized path'),
      );
      await expect(writeChanges(fs, outside, bad)).rejects.toThrow(
        new TypeError('Cannot save: x/a.yaml is outside the model folder'),
      );
      // after's own conditions before the comparison of the folders.
      await expect(writeChanges(fs, emptyModel(), outside)).rejects.toThrow(
        new TypeError('Cannot save: x/a.yaml is outside the model folder'),
      );
      await expect(
        writeChanges(fs, emptyModel(), { ...outside, entities: [] }),
      ).rejects.toThrow(
        new TypeError('Cannot save: the two models have different folders'),
      );
      expect(fs.calls).toEqual([]);
    });

    test('hostile models reject, never throw, with the reasons of FR-01', async () => {
      const fs = recordingFileSystem();
      const getterThrows = Object.defineProperty(emptyModel(), 'entities', {
        get() {
          throw new Error('no');
        },
      });
      const { proxy, revoke } = Proxy.revocable(emptyModel(), {});
      revoke();
      const cases: [unknown, unknown, string][] = [
        [undefined, emptyModel(), 'it is not an object'],
        [emptyModel(), 'x', 'it is not an object'],
        [getterThrows, emptyModel(), 'entities is not a list'],
        [emptyModel(), proxy, 'dir is not a normalized path'],
        [
          emptyModel({ dir: 7 as never }),
          emptyModel(),
          'dir is not a normalized path',
        ],
        [
          emptyModel(),
          emptyModel({ layouts: [null as never] }),
          'layouts[0] is not an item',
        ],
      ];
      for (const [before, after, reason] of cases) {
        let saving: Promise<unknown> | undefined;
        expect(() => {
          saving = writeChanges(fs, before as never, after as never);
        }).not.toThrow();
        await expect(saving).rejects.toThrow(
          new TypeError(`Cannot save: ${reason}`),
        );
      }
      expect(fs.calls).toEqual([]);
    });

    test('a data getter that throws rejects with its error before any adapter call', async () => {
      const fs = recordingFileSystem({ 'model.yaml': MANIFEST });
      const before = await load(fs);
      const error = new Error('data getter');
      const item = {
        file: 'entities/a.yaml',
        get data(): EntityData {
          throw error;
        },
      };
      ready(fs);
      await expect(
        writeChanges(fs, before, { ...before, entities: [item] }),
      ).rejects.toBe(error);
      expect(fs.calls).toEqual([]);
    });
  });

  describe('letter case', () => {
    const threeFiles = () => ({
      'model.yaml': MANIFEST,
      'entities/Customer.yaml': textOf(entity('entities/Customer.yaml', 'a')),
      'entities/cUstomer.yaml': textOf(entity('entities/cUstomer.yaml', 'b')),
      'entities/customer.yaml': textOf(
        entity('entities/customer.yaml', 'customer'),
      ),
      'entities/other.yaml': textOf(entity('entities/other.yaml', 'other')),
    });

    const changed = (model: Model, file: string): Model => ({
      ...model,
      entities: model.entities.map((item) =>
        item.file === file
          ? { ...item, data: { ...item.data, definition: 'changed' } }
          : item,
      ),
    });

    test('a pair the save does not touch stays; a touched one rejects', async () => {
      const fs = recordingFileSystem(threeFiles());
      const before = await load(fs);
      expect(before.entities.map((e) => e.file)).toHaveLength(4);

      ready(fs);
      await expect(
        writeChanges(fs, before, changed(before, 'entities/other.yaml')),
      ).resolves.toEqual({ written: ['entities/other.yaml'], removed: [] });

      for (const file of [
        'entities/Customer.yaml',
        'entities/cUstomer.yaml',
        'entities/customer.yaml',
      ]) {
        const bytes = await snapshot(fs);
        const after = changed(before, file);
        const first =
          file === 'entities/Customer.yaml'
            ? letterCase('entities/Customer.yaml', 'entities/cUstomer.yaml')
            : letterCase('entities/Customer.yaml', file);
        ready(fs);
        await expect(writeChanges(fs, before, after)).rejects.toThrow(first);
        expect(fs.calls).toEqual([]);
        expect(await snapshot(fs)).toEqual(bytes);
      }

      // Removing one of them touches it too.
      ready(fs);
      await expect(
        writeChanges(fs, before, {
          ...before,
          entities: before.entities.filter(
            (e) => e.file !== 'entities/customer.yaml',
          ),
        }),
      ).rejects.toThrow(
        letterCase('entities/Customer.yaml', 'entities/customer.yaml'),
      );
      expect(fs.calls).toEqual([]);
    });

    test('a hand-made rename by letter case rejects', async () => {
      const fs = recordingFileSystem();
      const before = emptyModel({
        entities: [entity('entities/Customer.yaml', 'customer')],
      });
      const after = emptyModel({
        entities: [entity('entities/customer.yaml', 'customer')],
      });
      await expect(writeChanges(fs, before, after)).rejects.toThrow(
        letterCase('entities/Customer.yaml', 'entities/customer.yaml'),
      );
      expect(fs.calls).toEqual([]);
    });

    test('two new paths with one key reject, by case or by normalization', async () => {
      const fs = recordingFileSystem();
      const nfcUpper = 'entities/É.yaml';
      const nfcLower = 'entities/é.yaml';
      const nfdLower = 'entities/é.yaml';
      await expect(
        writeChanges(
          fs,
          emptyModel(),
          emptyModel({
            entities: [entity(nfcLower, 'b'), entity(nfcUpper, 'a')],
          }),
        ),
      ).rejects.toThrow(letterCase(nfcUpper, nfcLower));
      await expect(
        writeChanges(
          fs,
          emptyModel(),
          emptyModel({
            entities: [entity(nfcLower, 'a')],
            subjectAreas: [
              { file: nfdLower, data: { id: 's', name: 's', entities: [] } },
            ],
          }),
        ),
      ).rejects.toThrow(letterCase(nfdLower, nfcLower));
      expect(fs.calls).toEqual([]);
    });

    test('of several pairs, the first by smaller then larger path', async () => {
      const fs = recordingFileSystem();
      const kept = [
        entity('entities/A.yaml', 'x'),
        entity('entities/a.yaml', 'y'),
      ];
      const before = emptyModel({ entities: kept });
      // A, a and the full-width ａ share a key; only ａ is touched, so the
      // pair is (A, ａ), not the untouched (A, a).
      await expect(
        writeChanges(fs, before, {
          ...before,
          entities: [
            ...kept,
            entity('entities/ａ.yaml', 'z'),
            entity('entities/b.yaml', 'b'),
            entity('entities/B.yaml', 'bb'),
          ],
        }),
      ).rejects.toThrow(letterCase('entities/A.yaml', 'entities/ａ.yaml'));
      await expect(
        writeChanges(fs, before, {
          ...before,
          entities: [
            ...kept,
            entity('entities/c.yaml', 'c'),
            entity('entities/C.yaml', 'cc'),
            entity('entities/b.yaml', 'b'),
            entity('entities/B.yaml', 'bb'),
          ],
        }),
      ).rejects.toThrow(letterCase('entities/B.yaml', 'entities/b.yaml'));
      expect(fs.calls).toEqual([]);
    });

    test('the five lists only: a dictionary path with the key of a new one is no pair', async () => {
      const fs = recordingFileSystem();
      const before = emptyModel({
        dictionaries: [{ file: 'entities/D.yaml', data: {} }],
      });
      const after = { ...before, entities: [entity('entities/d.yaml', 'd')] };
      await expect(writeChanges(fs, before, after)).resolves.toEqual({
        written: ['entities/d.yaml'],
        removed: [],
      });
    });
  });

  describe('serializing', () => {
    test('of two failures, the first by path; no adapter call', async () => {
      const fs = recordingFileSystem({ 'model.yaml': MANIFEST });
      const before = await load(fs);
      const fn = () => 1;
      ready(fs);
      await expect(
        writeChanges(fs, before, {
          ...before,
          entities: [
            entity('entities/b.yaml', 'b', { ext: { f: fn as never } }),
            entity('entities/a.yaml', 'a', { ext: { g: fn as never } }),
          ],
        }),
      ).rejects.toThrow(
        new TypeError(
          'Cannot write entities/a.yaml: /ext/g must be a JSON value',
        ),
      );
      expect(fs.calls).toEqual([]);
    });

    test('only items whose object differs are serialized and read', async () => {
      const fs = recordingFileSystem(exampleFiles());
      const before = await load(fs);
      const order = before.entities.find((e) => e.data.id === 'order')!;
      const after: Model = {
        ...before,
        manifest: {
          ...before.manifest!,
          data: { ...before.manifest!.data, name: 'X' },
        },
        dictionaries: before.dictionaries.map((d) => ({ ...d, data: {} })),
        entities: before.entities.map((e) =>
          e === order ? { ...e, data: { ...e.data, definition: 'd' } } : e,
        ),
      };
      ready(fs);
      await expect(writeChanges(fs, before, after)).resolves.toEqual({
        written: ['entities/order.yaml'],
        removed: [],
      });
      expect(serialized()).toEqual(['entities/order.yaml']);
      expect(fs.paths('readText')).toEqual(['entities/order.yaml']);
      expect(fs.paths('writeText')).toEqual(['entities/order.yaml']);
      expect(fs.paths('list')).toEqual([]);

      // Nothing differs by object: nothing is serialized, read or written.
      ready(fs);
      await expect(
        writeChanges(fs, after, { ...after, entities: [...after.entities] }),
      ).resolves.toEqual({ written: [], removed: [] });
      expect(serialized()).toEqual([]);
      expect(fs.calls).toEqual([]);
    });

    test('a new object with the same text is read but not written', async () => {
      const fs = recordingFileSystem(exampleFiles());
      const before = await load(fs);
      const after: Model = {
        ...before,
        layouts: before.layouts.map((l) => ({ ...l, data: { ...l.data } })),
      };
      ready(fs);
      await expect(writeChanges(fs, before, after)).resolves.toEqual({
        written: [],
        removed: [],
      });
      expect(serialized()).toEqual([
        'layouts/catalog.json',
        'layouts/sales.json',
      ]);
      expect(fs.paths('readText')).toEqual([
        'layouts/catalog.json',
        'layouts/sales.json',
      ]);
      expect(changes(fs)).toEqual([]);
    });
  });

  describe('new paths', () => {
    const one = entity('entities/x.yaml', 'x');

    async function refused(
      files: Record<string, string>,
      setup: (fs: RecordingFileSystem) => unknown = () => {},
    ): Promise<{ paths: (op: string) => string[] }> {
      const fs = recordingFileSystem(files);
      const before = await load(fs);
      expect(before.entities).toEqual([]);
      await setup(fs);
      const bytes = await snapshot(fs);
      ready(fs);
      await expect(
        writeChanges(fs, before, {
          ...before,
          entities: [...before.entities, one],
        }),
      ).rejects.toThrow(occupied('entities/x.yaml'));
      const record = [...fs.calls];
      expect(changes(fs)).toEqual([]);
      expect(await snapshot(fs)).toEqual(bytes);
      return {
        paths: (op: string) =>
          record.filter((c) => c.op === op).map((c) => c.path),
      };
    }

    test('a file there, listed', async () => {
      const fs = await refused({
        'model.yaml': MANIFEST,
        'entities/x.yaml': 'junk: [',
      });
      expect(fs.paths('readText')).toEqual([]);
    });

    test('a file with the very text to write, listed or found only by reading', async () => {
      // Written after loading, so the model does not hold it.
      await refused({ 'model.yaml': MANIFEST }, (fs) =>
        fs.writeText('entities/x.yaml', textOf(one)),
      );
      const fs = await refused({ 'model.yaml': MANIFEST }, async (fs) => {
        await fs.writeText('entities/x.yaml', textOf(one));
        fs.faults.unlisted.add('entities/x.yaml');
      });
      expect(fs.paths('readText')).toEqual(['entities/x.yaml']);
    });

    test('a folder of the same name', async () => {
      await refused({
        'model.yaml': MANIFEST,
        'entities/x.yaml/inner.yaml': 'a: 1\n',
      });
    });

    test('a folder or file whose name has the key of the new one', async () => {
      await refused({
        'model.yaml': MANIFEST,
        'entities/X.yaml/inner.yaml': 'a: 1\n',
      });
      // Left out on reading (not an entity), so in neither model.
      await refused({ 'model.yaml': MANIFEST, 'entities/X.yaml': 'id: 1\n' });
      await refused({ 'model.yaml': MANIFEST, 'entities/ｘ.yaml': 'id: 1\n' });
    });

    test('a file the listing leaves out but reading finds', async () => {
      const fs = await refused(
        { 'model.yaml': MANIFEST, 'entities/x.yaml': 'junk' },
        (fs) => fs.faults.unlisted.add('entities/x.yaml'),
      );
      expect(fs.paths('list')).toEqual(['entities']);
      expect(fs.paths('readText')).toEqual(['entities/x.yaml']);
    });

    test('a file left out on reading (a misspelled key) is not overwritten', async () => {
      const text = 'id: customer\nname: C\ndefiniton: x\nattributes: []\n';
      const fs = recordingFileSystem({
        'model.yaml': MANIFEST,
        'entities/customer.yaml': text,
      });
      const before = await load(fs);
      expect(before.entities).toEqual([]);
      ready(fs);
      await expect(
        writeChanges(fs, before, {
          ...before,
          entities: [entity('entities/customer.yaml', 'customer')],
        }),
      ).rejects.toThrow(occupied('entities/customer.yaml'));
      expect(changes(fs)).toEqual([]);
      expect(await fs.readText('entities/customer.yaml')).toBe(text);
    });

    test('a folder with another letter case, with a removal in the save', async () => {
      const old = entity('entities/old.yaml', 'old');
      const files = {
        'model.yaml': MANIFEST,
        'entities/old.yaml': textOf(old),
        'entities/Customer.yaml/z.yaml': 'a: 1\n',
      };
      const fs = recordingFileSystem(files);
      const before = await load(fs);
      expect(before.entities.map((e) => e.file)).toEqual(['entities/old.yaml']);
      ready(fs);
      await expect(
        writeChanges(fs, before, {
          ...before,
          entities: [entity('entities/customer.yaml', 'customer')],
        }),
      ).rejects.toThrow(occupied('entities/customer.yaml'));
      expect(changes(fs)).toEqual([]);
      expect(await fs.readText('entities/old.yaml')).toBe(
        files['entities/old.yaml'],
      );
    });

    test('parents are listed once each, only those of new paths, before any read', async () => {
      const fs = recordingFileSystem({ ...exampleFiles() });
      const before = await load(fs);
      const after: Model = {
        ...before,
        entities: [
          ...before.entities.map((e) =>
            e.data.id === 'tag' ? { ...e, data: { ...e.data, note: 'n' } } : e,
          ),
          entity('entities/b.yaml', 'b'),
          entity('entities/a.yaml', 'a'),
        ],
        subjectAreas: [
          ...before.subjectAreas,
          {
            file: 'subject-areas/s.yaml',
            data: { id: 's', name: 'S', entities: [] },
          },
        ],
      };
      ready(fs);
      await expect(writeChanges(fs, before, after)).resolves.toEqual({
        written: [
          'entities/a.yaml',
          'entities/b.yaml',
          'entities/tag.yaml',
          'subject-areas/s.yaml',
        ],
        removed: [],
      });
      expect(fs.calls.slice(0, 2)).toEqual([
        { op: 'list', path: 'entities' },
        { op: 'list', path: 'subject-areas' },
      ]);
      expect(fs.paths('list')).toHaveLength(2);
      expect(fs.paths('readText')).toEqual([
        'entities/a.yaml',
        'entities/b.yaml',
        'entities/tag.yaml',
        'subject-areas/s.yaml',
      ]);
    });

    test('parents in a model folder and the opened folder itself', async () => {
      const fs = recordingFileSystem({ 'm/model.yaml': MANIFEST });
      const before = await load(fs, 'm');
      expect(before.dir).toBe('m');
      ready(fs);
      await expect(
        writeChanges(fs, before, {
          ...before,
          entities: [entity('m/entities/x.yaml', 'x')],
          layouts: [
            { file: 'm/l.json', data: { formatVersion: '0.1', nodes: {} } },
          ],
        }),
      ).resolves.toEqual({
        written: ['m/entities/x.yaml', 'm/l.json'],
        removed: [],
      });
      expect(fs.paths('list')).toEqual(['m', 'm/entities']);

      const root = recordingFileSystem({
        'model.yaml': MANIFEST,
        'l.json': '{}',
      });
      const top = await load(root);
      ready(root);
      await expect(
        writeChanges(root, top, {
          ...top,
          layouts: [
            { file: 'l.json', data: { formatVersion: '0.1', nodes: {} } },
          ],
        }),
      ).rejects.toThrow(occupied('l.json'));
      expect(root.paths('list')).toEqual(['']);
    });
  });

  describe('the five checks, in order, each stopping at its first failure', () => {
    test('in one folder, the first occupied path by code units, whatever the listing order', async () => {
      const files = {
        'model.yaml': MANIFEST,
        'entities/a.yaml': 'x',
        'entities/b.yaml': 'x',
      };
      const fs = recordingFileSystem(files, reversedListing(files));
      const before = await load(fs);
      ready(fs);
      await expect(
        writeChanges(fs, before, {
          ...before,
          entities: [
            entity('entities/b.yaml', 'b'),
            entity('entities/a.yaml', 'a'),
          ],
        }),
      ).rejects.toThrow(occupied('entities/a.yaml'));
      expect(fs.paths('readText')).toEqual([]);
    });

    test('an occupied path in entities: subject-areas is not listed', async () => {
      const fs = recordingFileSystem({
        'model.yaml': MANIFEST,
        'entities/x.yaml': 'x',
      });
      const before = await load(fs);
      fs.faults.list.add('subject-areas');
      ready(fs);
      await expect(
        writeChanges(fs, before, {
          ...before,
          entities: [entity('entities/x.yaml', 'x')],
          subjectAreas: [
            {
              file: 'subject-areas/s.yaml',
              data: { id: 's', name: 'S', entities: [] },
            },
          ],
        }),
      ).rejects.toThrow(occupied('entities/x.yaml'));
      expect(fs.paths('list')).toEqual(['entities']);
      expect(fs.calls).toHaveLength(1);
    });

    test('a listing that fails: its error, and no read; it wins over a read that fails', async () => {
      const fs = recordingFileSystem({ 'model.yaml': MANIFEST });
      const before = await load(fs);
      fs.faults.list.add('entities');
      fs.faults.read.add('entities/x.yaml');
      ready(fs);
      const saving = writeChanges(fs, before, {
        ...before,
        entities: [entity('entities/x.yaml', 'x')],
      });
      await expect(saving).rejects.toThrow(
        "EACCES: permission denied, scandir 'entities'",
      );
      await expect(saving).rejects.toMatchObject({ code: 'EACCES' });
      expect(fs.paths('readText')).toEqual([]);
      expect(changes(fs)).toEqual([]);
    });

    test('what the listings find comes before what reads find, even of an earlier path', async () => {
      const files = {
        'model.yaml': MANIFEST,
        'entities/a.yaml': 'x',
        'entities/b.yaml': 'x',
        'subject-areas/s.yaml': 'x',
      };
      const fs = recordingFileSystem(files);
      const before = await load(fs);
      expect(before.entities).toEqual([]);
      fs.faults.unlisted.add('entities/a.yaml');
      const area = {
        file: 'subject-areas/s.yaml',
        data: { id: 's', name: 'S', entities: [] },
      };
      ready(fs);
      await expect(
        writeChanges(fs, before, {
          ...before,
          entities: [
            entity('entities/a.yaml', 'a'),
            entity('entities/b.yaml', 'b'),
          ],
        }),
      ).rejects.toThrow(occupied('entities/b.yaml'));
      fs.faults.unlisted.add('entities/b.yaml');
      ready(fs);
      await expect(
        writeChanges(fs, before, {
          ...before,
          entities: [entity('entities/a.yaml', 'a')],
          subjectAreas: [area],
        }),
      ).rejects.toThrow(occupied('subject-areas/s.yaml'));
      expect(fs.paths('readText')).toEqual([]);
    });

    test('reads go by path: an earlier EACCES or an earlier occupied path wins', async () => {
      const kept = entity('entities/a.yaml', 'a');
      const files = {
        'model.yaml': MANIFEST,
        'entities/a.yaml': textOf(kept),
        'entities/b.yaml': 'x',
        'entities/c.yaml': 'x',
      };
      const fs = recordingFileSystem(files);
      fs.faults.unlisted.add('entities/b.yaml');
      fs.faults.unlisted.add('entities/c.yaml');
      // The model holds only a.yaml: b and c are left out as not entities.
      const before = await load(fs);
      expect(before.entities.map((e) => e.file)).toEqual(['entities/a.yaml']);
      const loaded = before.entities[0]!;
      const changedA = entity('entities/a.yaml', 'a', { note: 'n' });

      // Two found only by reading, given in reverse: the first by path.
      ready(fs);
      await expect(
        writeChanges(fs, before, {
          ...before,
          entities: [
            loaded,
            entity('entities/c.yaml', 'c'),
            entity('entities/b.yaml', 'b'),
          ],
        }),
      ).rejects.toThrow(occupied('entities/b.yaml'));
      expect(fs.paths('readText')).toEqual(['entities/b.yaml']);

      // a.yaml is read first and fails.
      fs.faults.read.add('entities/a.yaml');
      ready(fs);
      await expect(
        writeChanges(fs, before, {
          ...before,
          entities: [changedA, entity('entities/b.yaml', 'b')],
        }),
      ).rejects.toThrow("EACCES: permission denied, open 'entities/a.yaml'");
      expect(fs.paths('readText')).toEqual(['entities/a.yaml']);
      expect(changes(fs)).toEqual([]);

      // The read that fails comes after the occupied path.
      fs.faults.read.delete('entities/a.yaml');
      fs.faults.read.add('entities/c.yaml');
      ready(fs);
      await expect(
        writeChanges(fs, before, {
          ...before,
          entities: [
            loaded,
            entity('entities/c.yaml', 'c'),
            entity('entities/b.yaml', 'b'),
          ],
        }),
      ).rejects.toThrow(occupied('entities/b.yaml'));
      expect(changes(fs)).toEqual([]);
    });

    test('a read that fails with EACCES rejects with no change', async () => {
      const fs = recordingFileSystem(exampleFiles());
      const before = await load(fs);
      fs.faults.read.add('entities/order.yaml');
      ready(fs);
      await expect(
        writeChanges(fs, before, {
          ...before,
          entities: before.entities.map((e) =>
            e.data.id === 'order'
              ? { ...e, data: { ...e.data, note: 'n' } }
              : e,
          ),
          subjectAreas: before.subjectAreas.filter(
            (s) => s.data.id !== 'sales',
          ),
        }),
      ).rejects.toMatchObject({ code: 'EACCES' });
      expect(changes(fs)).toEqual([]);
    });

    test('each check before the next: conditions, case, serializing, listing, reading', async () => {
      const files = {
        'model.yaml': MANIFEST,
        'entities/x.yaml': 'x',
      };
      const fs = recordingFileSystem(files);
      const before = await load(fs);
      const fn = () => 1;
      const listed = entity('entities/x.yaml', 'x');
      const readOnly = entity('entities/a.yaml', 'a');
      fs.faults.unlisted.add('entities/a.yaml');
      await fs.writeText('entities/a.yaml', 'a');
      const broken = entity('entities/z.yaml', 'z', {
        ext: { f: fn as never },
      });
      const pair = [
        entity('entities/Q.yaml', 'q'),
        entity('entities/q.yaml', 'qq'),
      ];
      const all = [listed, readOnly, broken, ...pair];
      const unnormalized = entity('entities//w.yaml', 'w');

      const attempt = (entities: ModelItem<EntityData>[]) => {
        ready(fs);
        return writeChanges(fs, before, { ...before, entities });
      };
      await expect(attempt([...all, unnormalized])).rejects.toThrow(
        new TypeError(
          'Cannot save: entities//w.yaml is not a normalized file path',
        ),
      );
      await expect(attempt(all)).rejects.toThrow(
        letterCase('entities/Q.yaml', 'entities/q.yaml'),
      );
      await expect(attempt([listed, readOnly, broken])).rejects.toThrow(
        new TypeError(
          'Cannot write entities/z.yaml: /ext/f must be a JSON value',
        ),
      );
      expect(fs.calls).toEqual([]);
      await expect(attempt([listed, readOnly])).rejects.toThrow(
        occupied('entities/x.yaml'),
      );
      expect(fs.paths('readText')).toEqual([]);
      await expect(attempt([readOnly])).rejects.toThrow(
        occupied('entities/a.yaml'),
      );
      expect(changes(fs)).toEqual([]);
    });
  });

  describe('write, then remove', () => {
    test('every writeText comes before every remove, each by path', async () => {
      const fs = recordingFileSystem(exampleFiles());
      const before = await load(fs);
      const after: Model = {
        ...before,
        entities: [
          entity('entities/zz.yaml', 'zz'),
          ...before.entities.map((e) =>
            e.data.id === 'order'
              ? { ...e, data: { ...e.data, note: 'n' } }
              : e,
          ),
          entity('entities/aa.yaml', 'aa'),
        ],
        subjectAreas: before.subjectAreas.filter((s) => s.data.id !== 'sales'),
        layouts: before.layouts.filter((l) => l.data.subjectArea !== 'sales'),
      };
      ready(fs);
      await expect(writeChanges(fs, before, after)).resolves.toEqual({
        written: [
          'entities/aa.yaml',
          'entities/order.yaml',
          'entities/zz.yaml',
        ],
        removed: ['layouts/sales.json', 'subject-areas/sales.yaml'],
      });
      expect(changes(fs)).toEqual([
        { op: 'writeText', path: 'entities/aa.yaml' },
        { op: 'writeText', path: 'entities/order.yaml' },
        { op: 'writeText', path: 'entities/zz.yaml' },
        { op: 'remove', path: 'layouts/sales.json' },
        { op: 'remove', path: 'subject-areas/sales.yaml' },
      ]);
      const bytes = await snapshot(fs);
      expect(bytes.has('layouts/sales.json')).toBe(false);
      expect(bytes.get('entities/aa.yaml')).toBe(
        textOf(entity('entities/aa.yaml', 'aa')),
      );
    });

    test('a write that fails: its error, the writes up to it, no remove', async () => {
      const old = entity('entities/old.yaml', 'old');
      const fs = recordingFileSystem({
        'model.yaml': MANIFEST,
        'entities/old.yaml': textOf(old),
      });
      const before = await load(fs);
      fs.faults.write.add('entities/b.yaml');
      ready(fs);
      await expect(
        writeChanges(fs, before, {
          ...before,
          entities: [
            entity('entities/b.yaml', 'b'),
            entity('entities/a.yaml', 'a'),
          ],
        }),
      ).rejects.toThrow("EACCES: permission denied, open 'entities/b.yaml'");
      expect(changes(fs)).toEqual([
        { op: 'writeText', path: 'entities/a.yaml' },
        { op: 'writeText', path: 'entities/b.yaml' },
      ]);
      expect(await fs.readText('entities/old.yaml')).toBe(textOf(old));
    });

    test('removes only what before held: strays stay, a missing file counts as removed', async () => {
      const files = {
        'model.yaml': MANIFEST,
        'entities/a.yaml': textOf(entity('entities/a.yaml', 'a')),
        'entities/b.yaml': textOf(entity('entities/b.yaml', 'b')),
        'entities/stray.yaml': 'id: 1\n',
        'entities-old/x.yaml': 'x',
      };
      const fs = recordingFileSystem(files);
      const before = await load(fs);
      expect(before.entities.map((e) => e.file)).toEqual([
        'entities/a.yaml',
        'entities/b.yaml',
      ]);
      await fs.remove('entities/b.yaml');
      ready(fs);
      await expect(
        writeChanges(fs, before, { ...before, entities: [] }),
      ).resolves.toEqual({
        written: [],
        removed: ['entities/a.yaml', 'entities/b.yaml'],
      });
      expect(fs.paths('remove')).toEqual([
        'entities/a.yaml',
        'entities/b.yaml',
      ]);
      const left = await snapshot(fs);
      expect(left.get('entities/stray.yaml')).toBe('id: 1\n');
      expect(left.get('entities-old/x.yaml')).toBe('x');
      expect([...left.keys()].sort()).toEqual([
        'entities-old/x.yaml',
        'entities/stray.yaml',
        'model.yaml',
      ]);
    });

    test('a path another list of after holds is not removed', async () => {
      const fs = recordingFileSystem({ 'model.yaml': MANIFEST });
      const before = emptyModel({
        manifest: (await load(fs)).manifest,
        entities: [entity('x.yaml', 'x')],
      });
      await fs.writeText('x.yaml', textOf(entity('x.yaml', 'x')));
      const after = emptyModel({
        manifest: before.manifest,
        subtypes: [
          { file: 'x.yaml', data: { id: 's', supertype: 'x', members: [] } },
        ],
      });
      ready(fs);
      const result = await writeChanges(fs, before, after);
      expect(result).toEqual({ written: ['x.yaml'], removed: [] });
      expect(fs.paths('list')).toEqual([]);
    });

    test('manifest and dictionaries are never read, written or removed', async () => {
      const fs = recordingFileSystem(exampleFiles());
      const before = await load(fs);
      ready(fs);
      await expect(
        writeChanges(fs, before, {
          ...before,
          manifest: undefined,
          dictionaries: [],
          entities: before.entities.filter((e) => e.data.id !== 'tag'),
        }),
      ).resolves.toEqual({ written: [], removed: ['entities/tag.yaml'] });
      for (const call of fs.calls) {
        expect(call.path).not.toBe('model.yaml');
        expect(call.path.startsWith('dictionary')).toBe(false);
      }
    });
  });
});
