import { describe, expect, test } from 'vitest';
import { joinPath, normalizePath, relativePath } from './path.js';

describe('normalizePath', () => {
  test.each([
    ['', ''],
    ['.', ''],
    ['a', 'a'],
    ['a/b', 'a/b'],
    ['a/./b', 'a/b'],
    ['a//b/', 'a/b'],
    ['a/../b', 'b'],
    ['a/b/../../c', 'c'],
    ['a/..', ''],
    ['..', '..'],
    ['../a', '../a'],
    ['../../a', '../../a'],
    ['a/../../b', '../b'],
    ['../a/../b', '../b'],
    ['./../a', '../a'],
  ])('%j → %j', (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });
});

describe('joinPath', () => {
  test.each([
    [['a', 'b.yaml'], 'a/b.yaml'],
    [['', 'model.yaml'], 'model.yaml'],
    [['a', ''], 'a'],
    [['', ''], ''],
    [['m', '../dictionary/standard.yaml'], 'dictionary/standard.yaml'],
    [['m', '../../dictionary'], '../dictionary'],
    [['', '../x'], '../x'],
    [['a/b', 'c', 'd.json'], 'a/b/c/d.json'],
  ])('%j → %j', (parts, expected) => {
    expect(joinPath(...parts)).toBe(expected);
  });
});

describe('relativePath', () => {
  test.each([
    ['', 'entities/a.yaml', 'entities/a.yaml'],
    ['m', 'm/entities/a.yaml', 'entities/a.yaml'],
    ['a/m', 'a/m/entities/a.yaml', 'entities/a.yaml'],
    ['m', 'dictionary/standard.yaml', '../dictionary/standard.yaml'],
    ['a/m', 'a/dict/x.yaml', '../dict/x.yaml'],
    ['a/b', 'c/d.yaml', '../../c/d.yaml'],
    ['', '../dictionary/x.yaml', '../dictionary/x.yaml'],
    ['m', '../d/x.yaml', '../../d/x.yaml'],
    ['../m', '../m/e.yaml', 'e.yaml'],
    ['../m', '../d/x.yaml', '../d/x.yaml'],
    ['m/./', 'm//e.yaml', 'e.yaml'],
    // The way back into the opened folder from outside it has no name.
    ['../m', 'e.yaml', 'e.yaml'],
    ['entities', 'entities-old/a.yaml', '../entities-old/a.yaml'],
  ])('from %j to %j → %j', (from, to, expected) => {
    expect(relativePath(from, to)).toBe(expected);
  });
});
