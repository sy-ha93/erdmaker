import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { schemaFiles } from '../generated/schemas.js';

const schemaDir = fileURLToPath(
  new URL('../../../../format/v0/schema/', import.meta.url),
);

describe('스키마 동기화', () => {
  const sourceNames = readdirSync(schemaDir)
    .filter((name) => name.endsWith('.schema.json'))
    .sort();

  test('the source folder holds 8 schema files', () => {
    expect(sourceNames).toHaveLength(8);
  });

  test('the generated module holds the same files', () => {
    expect(Object.keys(schemaFiles).sort()).toEqual(sourceNames);
  });

  test.each(sourceNames)(
    '%s matches its source, key order included',
    (name) => {
      const source: unknown = JSON.parse(
        readFileSync(`${schemaDir}${name}`, 'utf8'),
      );
      expect(JSON.stringify(schemaFiles[name])).toBe(JSON.stringify(source));
    },
  );
});
