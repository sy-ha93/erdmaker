import { describe, expect, test } from 'vitest';
import type { Issue } from '../model/types.js';
import { entityItem, exampleModel, handModel } from '../testing/editing.js';
import { rejectionIssues, reuseIssues } from './changes.js';
import { createEditor } from './editor.js';

const error = (
  rule: Issue['rule'],
  file: string,
  path: string,
  message: string,
): Issue => ({ rule, severity: 'error', file, path, message });

/** Appendix D, the rows of the entity commands. */
const APPENDIX_D: [unknown, Issue[]][] = [
  [
    { type: 'entity.delete', id: 'tag' },
    [
      error(
        'R02',
        'entities/product_tag.yaml',
        '/attributes/1/migratedFrom/0/attribute',
        'attribute "tag_no": parent "tag" has no attribute "tag_no"',
      ),
      error(
        'R02',
        'relationships/product_has_tag.yaml',
        '/child',
        '"product_has_tag": unknown child entity "tag"',
      ),
      error(
        'R02',
        'relationships/product_tag_tag.yaml',
        '/parent',
        '"product_tag_tag": unknown parent entity "tag"',
      ),
    ],
  ],
  [
    {
      type: 'entity.update',
      id: 'product',
      set: { physical: { name: 'ORDERS' } },
    },
    [
      error(
        'R11',
        'entities/product.yaml',
        '/physical/name',
        'table name "ORDERS" is already used by "order" in the same schema',
      ),
    ],
  ],
  [
    { type: 'entity.update', id: 'order', set: { scope: 'logical' } },
    [
      error(
        'R08',
        'entities/order.yaml',
        '/attributes/6/scope',
        'attribute "created_at": scope is wider than its entity\'s',
      ),
      ...['customer_places_order', 'order_bills_to'].map((id) =>
        error(
          'R08',
          `relationships/${id}.yaml`,
          '',
          `"${id}": scope is wider than its child entity's`,
        ),
      ),
      error(
        'R08',
        'relationships/order_contains_item.yaml',
        '',
        '"order_contains_item": scope is wider than its parent entity\'s',
      ),
      error(
        'R08',
        'relationships/order_ships_to.yaml',
        '',
        '"order_ships_to": scope is wider than its child entity\'s',
      ),
    ],
  ],
];

describe('검증 정책', () => {
  test.each(APPENDIX_D)('appendix D: %j', async (command, issues) => {
    const editor = createEditor(await exampleModel());
    const model = editor.model;
    const before = editor.issues;
    expect(before).toEqual([]);
    const first = issues[0]!;
    expect(editor.execute(command)).toEqual({
      ok: false,
      code: 'validation',
      message: `The command would break the model: ${first.file}: ${first.message}`,
      issues,
    });
    expect(editor.model).toBe(model);
    expect(editor.issues).toBe(before);
    expect(editor.canUndo).toBe(false);
  });

  test.todo('appendix D: the rows of the attribute and key commands (phase 6)');

  test('AC-07 (나): deleting one of three entities with one table name leaves one R11', () => {
    const editor = createEditor(
      handModel({
        entities: ['a', 'b', 'c'].map((id) =>
          entityItem(id, { physical: { name: 'T' } }),
        ),
      }),
    );
    expect(editor.issues.map((issue) => issue.rule)).toEqual(['R11', 'R11']);
    const result = editor.execute({ type: 'entity.delete', id: 'a' });
    expect(result.ok).toBe(true);
    expect(editor.issues.map((issue) => issue.rule)).toEqual(['R11']);
  });

  test.todo('AC-07 (가), (다), (라), (마) (phase 6)');

  test('a refusal on a model with errors lists only the new errors', () => {
    const editor = createEditor(
      handModel({
        entities: [
          entityItem('a', { physical: { name: 'T' } }),
          entityItem('b', { physical: { name: 'T' } }),
          entityItem('d', { physical: { name: 'U' } }),
        ],
      }),
    );
    expect(editor.issues.length).toBe(1);
    const result = editor.execute({
      type: 'entity.create',
      id: 'e',
      name: 'E',
      physical: { name: 'U' },
    });
    const added = error(
      'R11',
      'entities/e.yaml',
      '/physical/name',
      'table name "U" is already used by "d" in the same schema',
    );
    expect(result).toEqual({
      ok: false,
      code: 'validation',
      message: `The command would break the model: entities/e.yaml: ${added.message}`,
      issues: [added],
    });
  });

  test('predicate (가): new errors by rule, file, path and message against the old errors; all errors when none is new', () => {
    const old = error('R11', 'f', '/p', 'm');
    const warning: Issue = {
      ...error('R02', 'f', '/q', 'w'),
      severity: 'warning',
    };
    const same = { ...old, line: 3, column: 4 };
    const fresh = error('R11', 'f', '/p', 'other');
    const promoted = { ...warning, severity: 'error' as const };
    expect(rejectionIssues([old, warning], [same, fresh, warning])).toEqual([
      fresh,
    ]);
    // Only the errors of the old list count: a warning with the same rule,
    // file, path and message does not make an error old.
    expect(rejectionIssues([old, warning], [old, promoted])).toEqual([
      promoted,
    ]);
    expect(rejectionIssues([warning], [promoted])).toEqual([promoted]);
    expect(rejectionIssues([old], [old, old])).toEqual([old, old]);
    expect(rejectionIssues([], [warning, old])).toEqual([old]);
  });

  test('predicate (나): an issue equal in every field reuses the old object, others stay new', () => {
    const old = error('R11', 'f', '/p', 'm');
    const placed: Issue = {
      ...error('R02', 'f', '/q', 'n'),
      line: 1,
      column: 2,
    };
    const sameOld = { ...old };
    const samePlaced = { ...placed };
    const otherSeverity: Issue = { ...old, severity: 'warning' };
    const otherLine: Issue = { ...placed, line: 9 };
    const otherColumn: Issue = { ...placed, column: 9 };
    const placedOld: Issue = { ...old, line: 1, column: 1 };
    const next = [
      sameOld,
      samePlaced,
      otherSeverity,
      otherLine,
      otherColumn,
      placedOld,
    ];
    const kept = reuseIssues([old, placed], next);
    expect(kept).toEqual(next);
    expect(kept[0]).toBe(old);
    expect(kept[1]).toBe(placed);
    expect(kept[2]).toBe(otherSeverity);
    expect(kept[3]).toBe(otherLine);
    expect(kept[4]).toBe(otherColumn);
    expect(kept[5]).toBe(placedOld);
  });

  test('the issues kept after a command reuse the objects of the issues before', () => {
    const editor = createEditor(
      handModel({
        entities: [
          entityItem('a', { physical: { name: 'T' } }),
          entityItem('b', { physical: { name: 'T' } }),
        ],
      }),
    );
    const before = editor.issues;
    const result = editor.execute({
      type: 'entity.create',
      id: 'c',
      name: 'C',
    });
    expect(result.ok).toBe(true);
    expect(editor.issues).not.toBe(before);
    expect(editor.issues[0]).toBe(before[0]);
  });
});
