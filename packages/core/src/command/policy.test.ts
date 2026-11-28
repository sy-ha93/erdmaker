import { describe, expect, test } from 'vitest';
import { serializeModel } from '../model/serialize.js';
import type { Issue } from '../model/types.js';
import { entityItem, exampleModel, handModel } from '../testing/editing.js';
import { rejectionIssues, reuseIssues } from './changes.js';
import { createEditor } from './editor.js';
import { MOVE_ONTO_OLD_PLACE } from '../testing/commands.js';

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

/** Appendix D, the rows of the attribute and key commands, in its order. */
const APPENDIX_D_MEMBERS: [unknown, Issue[]][] = [
  [
    { type: 'attribute.delete', entity: 'order', id: 'ord_no' },
    [
      error(
        'R02',
        'entities/order_item.yaml',
        '/attributes/0/migratedFrom/0/attribute',
        'attribute "ord_no": parent "order" has no attribute "ord_no"',
      ),
      error(
        'R04',
        'relationships/order_contains_item.yaml',
        '',
        '"order_contains_item": parent "order" has no primary key to migrate',
      ),
    ],
  ],
  [
    { type: 'key.delete', entity: 'order', id: 'pk' },
    [
      error(
        'R04',
        'relationships/order_contains_item.yaml',
        '',
        '"order_contains_item": parent "order" has no primary key to migrate',
      ),
    ],
  ],
  [
    { type: 'attribute.delete', entity: 'order', id: 'cust_no' },
    [
      error(
        'R04',
        'relationships/customer_places_order.yaml',
        '',
        '"customer_places_order": customer.cust_no must migrate to exactly one attribute of "order" (found 0)',
      ),
    ],
  ],
  [
    {
      type: 'attribute.update',
      entity: 'customer',
      id: 'cust_no',
      set: { name: '고객ID' },
    },
    [
      'entities/address.yaml',
      'entities/corporate_customer.yaml',
      'entities/order.yaml',
      'entities/personal_customer.yaml',
    ].map((file) =>
      error(
        'R06',
        file,
        file === 'entities/address.yaml'
          ? '/attributes/1/name'
          : file === 'entities/order.yaml'
            ? '/attributes/1/name'
            : '/attributes/0/name',
        'attribute "cust_no": name differs from customer.cust_no but rolenamed is not set',
      ),
    ),
  ],
  [
    {
      type: 'key.create',
      entity: 'order',
      kind: 'primary',
      attributes: ['ord_dtm'],
    },
    [
      error(
        'R03',
        'entities/order.yaml',
        '/keys/2',
        'more than one primary key',
      ),
    ],
  ],
  [
    {
      type: 'attribute.update',
      entity: 'order',
      id: 'ord_dtm',
      set: { domain: 'nope' },
    },
    [
      error(
        'R02',
        'entities/order.yaml',
        '/attributes/4/domain',
        'attribute "ord_dtm": unknown domain "nope"',
      ),
    ],
  ],
  [
    { type: 'subjectArea.update', id: 'catalog', set: { group: 'nope' } },
    [
      error(
        'R12',
        'subject-areas/catalog.yaml',
        '/group',
        'unknown area group "nope"',
      ),
    ],
  ],
];

const rules = (editor: { issues: readonly Issue[] }) =>
  editor.issues.map((issue) => issue.rule);

/**
 * AC-07 (가): entity `e` with two primary keys (one R03), and an entity `f`
 * to change elsewhere. Built from data, with no command.
 */
const twoPrimaryKeys = () =>
  handModel({
    entities: [
      entityItem('e', {
        attributes: ['a', 'b', 'c'].map((id) => ({ id, name: id })),
        keys: [
          { id: 'pk', kind: 'primary', attributes: ['a'] },
          { id: 'pk2', kind: 'primary', attributes: ['b'] },
        ],
      }),
      entityItem('f', { attributes: [{ id: 'x', name: 'x' }] }),
    ],
  });

/**
 * AC-07 (다): the key attribute `p.id` of a parent migrated to three
 * attributes of child `c` (one R04, found 3).
 */
const migratedThrice = () => {
  const migrated = (id: string) => ({
    id,
    name: 'id',
    migratedFrom: [{ relationship: 'p_has_c', attribute: 'id' }],
  });
  return handModel({
    entities: [
      entityItem('p', {
        attributes: [{ id: 'id', name: 'id' }],
        keys: [{ id: 'pk', kind: 'primary', attributes: ['id'] }],
      }),
      entityItem('c', {
        attributes: [migrated('p_id'), migrated('p_id_2'), migrated('p_id_3')],
      }),
    ],
    relationships: [
      {
        file: 'relationships/p_has_c.yaml',
        data: {
          id: 'p_has_c',
          kind: 'non-identifying',
          parent: 'p',
          child: 'c',
        },
      },
    ],
  });
};

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

  test.each(APPENDIX_D_MEMBERS)('appendix D: %j', async (command, issues) => {
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

  test('appendix D has its ten rows', () => {
    expect(APPENDIX_D.length + APPENDIX_D_MEMBERS.length).toBe(10);
  });

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

  test('AC-07 (가): a third primary key on an entity with two still gives one R03', () => {
    const editor = createEditor(twoPrimaryKeys());
    expect(rules(editor)).toEqual(['R03']);
    const result = editor.execute({
      type: 'key.create',
      entity: 'e',
      kind: 'primary',
      id: 'pk3',
      attributes: ['c'],
    });
    expect(result.ok).toBe(true);
    expect(rules(editor)).toEqual(['R03']);
  });

  test('AC-07 (다): deleting one of three attributes a parent key attribute migrated to leaves one R04, found 2', () => {
    const editor = createEditor(migratedThrice());
    const r04 = () =>
      editor.issues
        .filter((issue) => issue.rule === 'R04')
        .map((i) => i.message);
    expect(r04()).toEqual([
      '"p_has_c": p.id must migrate to exactly one attribute of "c" (found 3)',
    ]);
    const result = editor.execute({
      type: 'attribute.delete',
      entity: 'c',
      id: 'p_id_2',
    });
    expect(result.ok).toBe(true);
    expect(r04()).toEqual([
      '"p_has_c": p.id must migrate to exactly one attribute of "c" (found 2)',
    ]);
    expect(editor.issues.filter((issue) => issue.rule === 'R04')).toHaveLength(
      1,
    );
  });

  test('AC-07 (라): on the (가) model another entity takes attribute.update; an unknown domain is its one R02', () => {
    const editor = createEditor(twoPrimaryKeys());
    expect(
      editor.execute({
        type: 'attribute.update',
        entity: 'f',
        id: 'x',
        set: { definition: 'd' },
      }).ok,
    ).toBe(true);
    expect(
      editor.execute({
        type: 'attribute.update',
        entity: 'f',
        id: 'x',
        set: { domain: 'nope' },
      }),
    ).toEqual({
      ok: false,
      code: 'validation',
      message:
        'The command would break the model: entities/f.yaml: attribute "x": unknown domain "nope"',
      issues: [
        error(
          'R02',
          'entities/f.yaml',
          '/attributes/0/domain',
          'attribute "x": unknown domain "nope"',
        ),
      ],
    });
  });

  test('AC-07 (마): deleting one of the two primary keys leaves no issue', () => {
    const editor = createEditor(twoPrimaryKeys());
    const result = editor.execute({
      type: 'key.delete',
      entity: 'e',
      id: 'pk2',
    });
    expect(result.ok).toBe(true);
    expect(editor.issues).toEqual([]);
  });

  test('AC-07 (바): an unsafe integer for an entity with an R02 is refused by the input copy', () => {
    // Codex's first case. The key refers to a missing attribute: one R02.
    // `2 ** 53` is no JSON value F02 can write; the copy refuses it before
    // any handler runs (FR-03), so the R02 cannot be hidden by it.
    const editor = createEditor(
      handModel({
        entities: [
          entityItem('a', {
            keys: [{ id: 'k', kind: 'primary', attributes: ['missing'] }],
          }),
        ],
      }),
    );
    expect(rules(editor)).toEqual(['R02']);
    const model = editor.model;
    const before = editor.issues;
    expect(
      editor.execute({
        type: 'entity.update',
        id: 'a',
        set: { ext: { wide: 2 ** 53 } },
      }),
    ).toEqual({
      ok: false,
      code: 'invalid-command',
      message: '/set/ext/wide must be a JSON value',
      issues: [],
    });
    expect(editor.model).toBe(model);
    expect(editor.issues).toBe(before);
    expect(editor.canUndo).toBe(false);
  });

  test('AC-07: the batch that moves a value onto the place of an old unwritable one is refused by the input copy', () => {
    // The re-check's case 1: `a.ext.wide` is undefined (unwritable); the
    // batch repairs `a`, moves `b` before it and gives `b` an unsafe integer.
    const editor = createEditor(
      handModel({
        entities: [
          entityItem('x', {
            attributes: [
              { id: 'a', name: 'A', ext: { wide: undefined as never } },
              { id: 'b', name: 'B' },
            ],
          }),
        ],
      }),
    );
    const model = editor.model;
    expect(editor.execute(MOVE_ONTO_OLD_PLACE)).toEqual({
      ok: false,
      code: 'invalid-command',
      message: '/commands/2/set/ext/wide must be a JSON value',
      issues: [],
    });
    expect(editor.model).toBe(model);
  });

  test('AC-07: deleting an attribute before an old schema error moves the error and is accepted', () => {
    // The re-check's case 2: `bad.name` is 3 (a schema error a file can
    // still hold). Deleting `good` moves it from /attributes/1/name to
    // /attributes/0/name; the item is writable and the count stays.
    const editor = createEditor(
      handModel({
        entities: [
          entityItem('x', {
            attributes: [
              { id: 'good', name: 'G' },
              { id: 'bad', name: 3 as never },
            ],
          }),
        ],
      }),
    );
    expect(editor.issues.map((issue) => issue.path)).toEqual([
      '/attributes/1/name',
    ]);
    const result = editor.execute({
      type: 'attribute.delete',
      entity: 'x',
      id: 'good',
    });
    expect(result.ok).toBe(true);
    expect(editor.issues).toEqual([
      error(
        'schema',
        'entities/x.yaml',
        '/attributes/0/name',
        '/attributes/0/name must be string',
      ),
    ]);
    expect(() => serializeModel(editor.model)).not.toThrow();
  });

  test('a model with an unwritable item takes an edit of another item', () => {
    const editor = createEditor(
      handModel({
        entities: [
          entityItem('a', { ext: { wide: 2 ** 53 } }),
          entityItem('b'),
        ],
      }),
    );
    expect(rules(editor)).toEqual(['schema']);
    const result = editor.execute({
      type: 'entity.update',
      id: 'b',
      set: { note: 'n' },
    });
    expect(result.ok).toBe(true);
    expect(rules(editor)).toEqual(['schema']);
  });

  test('an item that cannot be written is changed when a command touches it, even with the same values (FR-02)', () => {
    // Its data is a new object and no text compares it with the old one.
    const editor = createEditor(
      handModel({ entities: [entityItem('a', { ext: { wide: 2 ** 53 } })] }),
    );
    const model = editor.model;
    const result = editor.execute({
      type: 'entity.update',
      id: 'a',
      set: { name: 'a' },
    });
    expect(result.ok).toBe(true);
    expect(editor.model).not.toBe(model);
    expect(editor.model.entities[0]).not.toBe(model.entities[0]);
    expect(editor.canUndo).toBe(true);
    // It was unwritable before, so (a) of FR-04 leaves it to the caller.
    expect(rules(editor)).toEqual(['schema']);
  });

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
