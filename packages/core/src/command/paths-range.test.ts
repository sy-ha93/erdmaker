import { describe, expect, test, vi } from 'vitest';

// A string too large to split or join throws a RangeError. Making one for
// real takes hundreds of megabytes, so `normalizePath` throws it here for
// any path over a small length, as the engine would for an enormous one.
vi.mock('../fs/path.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../fs/path.js')>();
  return {
    ...actual,
    normalizePath: (path: string) => {
      if (path.length > 10_000) throw new RangeError('Invalid string length');
      return actual.normalizePath(path);
    },
  };
});

const { dictionaryFolders } = await import('./paths.js');

const manifest = (dictionaries: string[]) => ({
  file: 'm/model.yaml',
  data: { formatVersion: '0.1', id: 'm', name: 'M', dictionaries },
});

describe('사전 폴더: 너무 큰 글', () => {
  test('an entry that normalizing throws a RangeError for is left out; the others stay', () => {
    const huge = 'y'.repeat(10_001);
    expect(
      dictionaryFolders('m', manifest([huge, 'entities', `z${huge}`])),
    ).toEqual(['m/entities']);
  });

  test('a model folder that normalizing throws for leaves every folder out', () => {
    expect(
      dictionaryFolders('d'.repeat(10_001), manifest(['entities'])),
    ).toEqual([]);
  });
});
