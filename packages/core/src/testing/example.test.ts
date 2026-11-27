import { describe, expect, test } from 'vitest';
import { exampleFileSystem, exampleFiles, replaceOnce } from './example.js';

describe('example helpers', () => {
  test('reads the 29 example files, YAML and layout JSON, in path order', () => {
    const paths = Object.keys(exampleFiles());
    expect(paths).toHaveLength(29);
    expect(paths).toEqual([...paths].sort());
    expect(paths.filter((path) => path.endsWith('.yaml'))).toHaveLength(27);
    expect(paths.filter((path) => path.endsWith('.json'))).toEqual([
      'layouts/catalog.json',
      'layouts/sales.json',
    ]);
    expect(exampleFiles()['subject-areas/party.yaml']).toBe(
      'id: party\nname: 고객\ngroup: master\nentities:\n  - address\n  - corporate_customer\n  - customer\n  - personal_customer\n',
    );
  });

  test('replaces the one occurrence and leaves the input and other files alone', () => {
    const files = exampleFiles();
    const before = { ...files };
    const changed = replaceOnce(
      files,
      'subject-areas/party.yaml',
      'group: master\n',
      'group: trade\n',
    );
    expect(files).toEqual(before);
    expect(changed['subject-areas/party.yaml']).toBe(
      before['subject-areas/party.yaml']?.replace('master', 'trade'),
    );
    expect({ ...changed, 'subject-areas/party.yaml': '' }).toEqual({
      ...before,
      'subject-areas/party.yaml': '',
    });
  });

  test('throws when the text is missing, repeated or overlapping, or the file is missing', () => {
    const files = { 'a.yaml': 'x: aaa\ny: b\n' };
    expect(() => replaceOnce(files, 'a.yaml', 'z', '')).toThrow(
      '"z" is not in a.yaml',
    );
    expect(() => replaceOnce(files, 'a.yaml', 'a', '')).toThrow(
      '"a" occurs more than once in a.yaml',
    );
    expect(() => replaceOnce(files, 'a.yaml', 'aa', '')).toThrow(
      '"aa" occurs more than once in a.yaml',
    );
    expect(() => replaceOnce(files, 'b.yaml', 'x', '')).toThrow(
      'No file b.yaml',
    );
  });

  test('the memory adapter holds the files', async () => {
    const fs = exampleFileSystem(
      replaceOnce(exampleFiles(), 'model.yaml', 'id: shop', 'id: other'),
    );
    expect(await fs.readText('model.yaml')).toContain('id: other\n');
    expect((await fs.list('layouts')).map((entry) => entry.name)).toEqual([
      'catalog.json',
      'sales.json',
    ]);
  });
});
