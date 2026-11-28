import { describe, expect, test, vi } from 'vitest';
import type { FileSystemAdapter } from '../fs/adapter.js';
import { createMemoryFileSystem } from '../fs/memory.js';
import { AWKWARD_STRINGS } from '../testing/generate.js';
import {
  dictionaryFolderOf,
  dictionaryFolders,
  fileSpace,
  InitialPaths,
  listReservedFiles,
  newItemFile,
  pathKey,
  pathKeys,
  reservedPaths,
} from './paths.js';

describe('새 파일 경로: 비교 키', () => {
  test('letter case, NFC and NFD, full and half width give one key', () => {
    expect(pathKey('entities/Customer.yaml')).toBe(
      pathKey('entities/customer.yaml'),
    );
    expect(pathKey('entities/cUSTOMER.yaml')).toBe('entities/customer.yaml');
    expect(pathKey('entities/\u00e9.yaml')).toBe(
      pathKey('entities/e\u0301.yaml'),
    );
    expect(pathKey('entities/\u00c9.yaml')).toBe(
      pathKey('entities/\u00e9.yaml'),
    );
    expect(pathKey('entities/ＡＢＣ.yaml')).toBe(pathKey('entities/abc.yaml'));
  });

  test('other letters keep other keys', () => {
    const paths = [
      'entities/a.yaml',
      'entities/b.yaml',
      'entities/e.yaml',
      'entities/\u00e9.yaml',
      'entities/a_2.yaml',
      'Entities/a.yml',
      'subject-areas/a.yaml',
    ];
    expect(new Set(paths.map(pathKey)).size).toBe(paths.length);
  });

  test('never throws on lone surrogates and awkward text', () => {
    for (const text of [
      ...AWKWARD_STRINGS,
      '\ud800',
      'a\udc00b',
      '\udfff\ud800',
    ]) {
      expect(typeof pathKey(text)).toBe('string');
    }
    expect(pathKey('A\ud800')).toBe('a\ud800');
  });
});

describe('새 파일 경로', () => {
  test('a new item goes to entities/ or subject-areas/ under the model folder as given', () => {
    expect(newItemFile('', 'entities', 'order')).toBe('entities/order.yaml');
    expect(newItemFile('billing', 'entities', 'order')).toBe(
      'billing/entities/order.yaml',
    );
    expect(newItemFile('Billing', 'subject-areas', 'sales')).toBe(
      'Billing/subject-areas/sales.yaml',
    );
    expect(newItemFile('a/b', 'subject-areas', 'x_2')).toBe(
      'a/b/subject-areas/x_2.yaml',
    );
  });

  test('a path is in use when any used path has its key', () => {
    const space = fileSpace({
      dir: '',
      folder: 'entities',
      used: pathKeys([
        'model.yaml',
        'entities/Customer.yaml',
        'entities/É.yaml',
      ]),
      initial: new InitialPaths([]),
      dictionaryFolders: [],
    });
    expect(space.fileOf('customer')).toBe('entities/customer.yaml');
    expect(space.isUsed('entities/customer.yaml')).toBe(true);
    expect(space.isUsed('entities/e\u0301.yaml')).toBe(true);
    expect(space.isUsed('entities/customer_2.yaml')).toBe(false);
    expect(space.isUsed('entities/model.yaml')).toBe(false);
  });

  test('a path that differs from initial paths only by key names the first of them in code unit order', () => {
    const initial = new InitialPaths([
      'entities/customer.yaml',
      'entities/cUstomer.yaml',
      'entities/Customer.yaml',
      'entities/order.yaml',
    ]);
    // Code unit order: `Customer` < `cUstomer` < `customer`.
    expect(initial.otherCase('entities/customer.yaml')).toBe(
      'entities/Customer.yaml',
    );
    expect(initial.otherCase('entities/Customer.yaml')).toBe(
      'entities/cUstomer.yaml',
    );
    expect(initial.otherCase('entities/CUSTOMER.yaml')).toBe(
      'entities/Customer.yaml',
    );
    expect(initial.otherCase('entities/order.yaml')).toBeUndefined();
    expect(initial.otherCase('entities/Order.yaml')).toBe(
      'entities/order.yaml',
    );
    expect(initial.otherCase('entities/other.yaml')).toBeUndefined();
    expect(initial.has('entities/order.yaml')).toBe(true);
    expect(initial.has('entities/Order.yaml')).toBe(false);
  });

  test('an initial path with the same text alone is not another case', () => {
    const initial = new InitialPaths(['entities/customer.yaml']);
    expect(initial.otherCase('entities/customer.yaml')).toBeUndefined();
    const nfd = new InitialPaths(['entities/e\u0301.yaml']);
    expect(nfd.otherCase('entities/\u00e9.yaml')).toBe('entities/e\u0301.yaml');
  });

  test('dictionary folders: dictionaries, else dictionary; absolute entries dropped; normalized under the model folder', () => {
    expect(dictionaryFolders('', undefined)).toEqual(['dictionary']);
    expect(dictionaryFolders('m', undefined)).toEqual(['m/dictionary']);
    expect(
      dictionaryFolders('m', [
        '../dictionary',
        'words/./a',
        '/abs',
        'C:\\x',
        '\\x',
      ]),
    ).toEqual(['dictionary', 'm/words/a']);
    expect(dictionaryFolders('', ['.'])).toEqual(['']);
    expect(dictionaryFolders('m', ['..'])).toEqual(['']);
    expect(dictionaryFolders('', [])).toEqual([]);
  });

  test('inside a dictionary folder: leading components compared by key; the opened folder holds every path', () => {
    expect(dictionaryFolderOf('entities/customer.yaml', ['entities'])).toBe(
      'entities',
    );
    expect(dictionaryFolderOf('entities/customer.yaml', ['Entities'])).toBe(
      'Entities',
    );
    expect(
      dictionaryFolderOf('entities/customer.yaml', ['entities-old']),
    ).toBeUndefined();
    expect(
      dictionaryFolderOf('entities/customer.yaml', ['entit']),
    ).toBeUndefined();
    expect(dictionaryFolderOf('billing/entities/a.yaml', ['billing'])).toBe(
      'billing',
    );
    expect(
      dictionaryFolderOf('billing/entities/a.yaml', [
        'dictionary',
        'billing/entities',
      ]),
    ).toBe('billing/entities');
    expect(dictionaryFolderOf('entities/a.yaml', [''])).toBe('.');
    expect(
      dictionaryFolderOf('entities/a.yaml', ['dictionary']),
    ).toBeUndefined();
    // The path itself is not inside a folder of its own name.
    expect(
      dictionaryFolderOf('entities/a.yaml', ['entities/a.yaml']),
    ).toBeUndefined();
    expect(dictionaryFolderOf('entities/a.yaml', [])).toBeUndefined();
  });

  test('a dictionary folder at or above the opened folder holds every model path', () => {
    const inside = (dir: string, entries: string[], path: string) =>
      dictionaryFolderOf(path, dictionaryFolders(dir, entries));
    expect(inside('', ['.'], 'entities/a.yaml')).toBe('.');
    expect(inside('', ['..'], 'entities/a.yaml')).toBe('..');
    expect(inside('', ['../..'], 'subject-areas/a.yaml')).toBe('../..');
    expect(inside('m', ['../..'], 'm/entities/a.yaml')).toBe('..');
    expect(inside('m', ['..'], 'm/entities/a.yaml')).toBe('.');
    expect(inside('', ['../shared'], 'entities/a.yaml')).toBeUndefined();
    expect(inside('m', ['../shared'], 'm/entities/a.yaml')).toBeUndefined();
  });

  test('the file space answers the dictionary folder for its folder', () => {
    const space = fileSpace({
      dir: '',
      folder: 'subject-areas',
      used: new Set(),
      initial: new InitialPaths([]),
      dictionaryFolders: ['subject-areas'],
    });
    expect(space.dictionaryFolderOf('subject-areas/a.yaml')).toBe(
      'subject-areas',
    );
  });

  test('reserved paths are normalized, without the paths of the initial model, once each', () => {
    const initial = new InitialPaths(['entities/a.yaml', 'model.yaml']);
    expect(
      reservedPaths(
        [
          'entities/a.yaml',
          'entities//b.yaml',
          './entities/b.yaml',
          'entities/A.yaml',
          'subject-areas/x.yaml',
        ],
        initial,
      ),
    ).toEqual(['entities/b.yaml', 'entities/A.yaml', 'subject-areas/x.yaml']);
    expect(reservedPaths([], initial)).toEqual([]);
    expect(reservedPaths(['model.yaml'], initial)).toEqual([]);
    // Entries that normalize to nothing are ignored.
    expect(reservedPaths(['', '.', 'a/..', 'x'], initial)).toEqual(['x']);
  });

  test('reserved files that are not an array of strings throw one TypeError', () => {
    const initial = new InitialPaths([]);
    const throwing = new Proxy(['a'], {
      get(target, key, receiver) {
        if (key === '0') throw new Error('trap');
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    const badLength = new Proxy(['a'], {
      get(target, key, receiver) {
        if (key === 'length') throw new Error('trap');
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    const revoked = Proxy.revocable([], {});
    revoked.revoke();
    for (const input of [
      new Set(['a']),
      'entities/a.yaml',
      null,
      { length: 0 },
      ['a', 1],
      // eslint-disable-next-line no-sparse-arrays
      ['a', , 'b'],
      [undefined],
      throwing,
      badLength,
      revoked.proxy,
    ]) {
      expect(() => reservedPaths(input, initial)).toThrow(
        new TypeError(
          'Cannot edit the model: reservedFiles is not a list of paths',
        ),
      );
      try {
        reservedPaths(input, initial);
      } catch (error) {
        expect(error).toBeInstanceOf(TypeError);
      }
    }
  });

  describe('listReservedFiles', () => {
    const counting = (fs: FileSystemAdapter) => {
      const list = vi.fn(fs.list.bind(fs));
      return { fs: { ...fs, list }, list };
    };

    test('everything directly under entities/ and subject-areas/: model files, folders, broken files', async () => {
      const { fs, list } = counting(
        createMemoryFileSystem({
          'model.yaml': 'formatVersion: "0.1"\nid: m\nname: M\n',
          'entities/a.yaml': 'id: a\nname: A\nattributes: []\n',
          'entities/b.yaml/inner.yaml': 'x: 1\n',
          'entities/c.yaml': ': : :\n',
          'subject-areas/s.yaml': 'id: s\nname: S\nentities: []\n',
          'layouts/main.json': '{}',
        }),
      );
      expect(await listReservedFiles(fs, '')).toEqual([
        'entities/a.yaml',
        'entities/b.yaml',
        'entities/c.yaml',
        'subject-areas/s.yaml',
      ]);
      expect(list).toHaveBeenCalledTimes(2);
      expect(list.mock.calls).toEqual([['entities'], ['subject-areas']]);
    });

    test('a model with a folder lists under it, and nothing there is an empty list', async () => {
      const { fs, list } = counting(
        createMemoryFileSystem({
          'billing/model.yaml': 'x',
          'billing/subject-areas/Z.yaml': 'x',
          'billing/subject-areas/a.YAML': 'x',
          'entities/outside.yaml': 'x',
        }),
      );
      expect(await listReservedFiles(fs, 'billing')).toEqual([
        'billing/subject-areas/Z.yaml',
        'billing/subject-areas/a.YAML',
      ]);
      expect(list.mock.calls).toEqual([
        ['billing/entities'],
        ['billing/subject-areas'],
      ]);
    });

    test('in code unit order whatever order the adapter lists in', async () => {
      const fs: FileSystemAdapter = {
        ...createMemoryFileSystem(),
        list: (dir) =>
          Promise.resolve(
            dir === 'entities'
              ? [
                  { name: 'b.yaml', kind: 'file' },
                  { name: 'B.yaml', kind: 'directory' },
                  { name: 'a.yaml', kind: 'file' },
                ]
              : [{ name: 'z.yaml', kind: 'file' }],
          ),
      };
      expect(await listReservedFiles(fs, '')).toEqual([
        'entities/B.yaml',
        'entities/a.yaml',
        'entities/b.yaml',
        'subject-areas/z.yaml',
      ]);
    });

    test('an adapter error passes through', async () => {
      const error = new Error('EACCES');
      const fs: FileSystemAdapter = {
        ...createMemoryFileSystem(),
        list: () => Promise.reject(error),
      };
      await expect(listReservedFiles(fs, '')).rejects.toBe(error);
    });
  });
});
