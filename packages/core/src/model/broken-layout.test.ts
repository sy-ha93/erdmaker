import { describe, expect, test } from 'vitest';
import {
  exampleFileSystem,
  exampleFiles,
  type Files,
  replaceOnce,
} from '../testing/example.js';
import { validateModel } from '../validate/index.js';
import { finishIssues } from '../validate/issues.js';
import { loadModel } from './load.js';
import type { Issue } from './types.js';

const SALES = 'layouts/sales.json';
const CATALOG = 'layouts/catalog.json';
const TAG = 'entities/tag.yaml';

/** Reads the files from disk-like memory and validates the model, as `validateProject` does. */
async function check(files: Files) {
  const loaded = await loadModel(exampleFileSystem(files), '');
  const issues = finishIssues([
    ...loaded.issues,
    ...validateModel(loaded.model, loaded.positions),
  ]);
  return { ...loaded, issues };
}

/** The example with `layouts/sales.json` replaced by `text`. */
function withSales(text: string, files: Files = exampleFiles()): Files {
  const sales = files[SALES];
  if (sales === undefined) throw new Error(`No ${SALES}`);
  return replaceOnce(files, SALES, sales, text);
}

const unknownDomain = (files: Files) =>
  replaceOnce(files, TAG, '    domain: name\n', '    domain: namex\n');

describe('깨진 배치', () => {
  test('a layout cut off after "nodes": one syntax error at 2:1, and the other rules still run', async () => {
    const files = withSales(
      '{"formatVersion": "0.1", "nodes": {\n',
      unknownDomain(exampleFiles()),
    );
    const result = await check(files);
    expect(result.issues).toEqual<Issue[]>([
      {
        rule: 'R02',
        severity: 'error',
        file: TAG,
        path: '/attributes/1/domain',
        line: 14,
        column: 5,
        message: 'attribute "tag_nm": unknown domain "namex"',
      },
      {
        rule: 'syntax',
        severity: 'error',
        file: SALES,
        path: '',
        line: 2,
        column: 1,
        message:
          "Expected property name or '}' in JSON at position 36 (line 2 column 1)",
      },
    ]);
    expect(result.model.layouts.map((item) => item.file)).toEqual([CATALOG]);
    expect(result.positions.has(SALES)).toBe(false);
  });

  test('the layout rules still check the other layout', async () => {
    const files = withSales(
      '{"formatVersion": "0.1", "nodes": {\n',
      replaceOnce(exampleFiles(), CATALOG, '"tag": {', '"tagx": {'),
    );
    const { issues } = await check(files);
    expect(issues).toEqual<Issue[]>([
      {
        rule: 'R09',
        severity: 'error',
        file: CATALOG,
        path: '/nodes/tagx',
        line: 8,
        column: 5,
        message: 'node for unknown entity "tagx"',
      },
      {
        rule: 'syntax',
        severity: 'error',
        file: SALES,
        path: '',
        line: 2,
        column: 1,
        message:
          "Expected property name or '}' in JSON at position 36 (line 2 column 1)",
      },
    ]);
  });

  test('two "nodes" keys on one line: one syntax error at the second key', async () => {
    const { issues, model } = await check(
      withSales('{"formatVersion": "0.1", "nodes": {}, "nodes": {}}\n'),
    );
    expect(issues).toEqual<Issue[]>([
      {
        rule: 'syntax',
        severity: 'error',
        file: SALES,
        path: '',
        line: 1,
        column: 39,
        message: 'Map keys must be unique at line 1, column 39:',
      },
    ]);
    expect(model.layouts.map((item) => item.file)).toEqual([CATALOG]);
  });
});
