import { describe, expect, test } from 'vitest';
import { joinPath, normalizePath } from './path.js';

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
