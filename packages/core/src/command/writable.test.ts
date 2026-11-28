import { beforeEach, describe, expect, test, vi } from 'vitest';
import { serializeModel } from '../model/serialize.js';
import { serializeItem } from '../model/serialize-item.js';
import type { Issue } from '../model/types.js';
import { entityItem, handModel } from '../testing/editing.js';
import { MOVE_ONTO_OLD_PLACE } from '../testing/commands.js';
import { createEditor } from './editor.js';

// FR-04 (a) on its own. The input copy refuses an unsafe integer (FR-03),
// so no command can bring one into the model; here the copy is a plain
// `structuredClone`, which lets one through, to pin the acceptance rule
// itself. `serializeItem` is the real one, counted, and fails on demand.
vi.mock('./copy.js', () => ({
  copyCommand: (input: unknown) => ({
    ok: true,
    value: structuredClone(input),
  }),
}));
vi.mock('../model/serialize-item.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../model/serialize-item.js')>();
  return { ...actual, serializeItem: vi.fn(actual.serializeItem) };
});

const real = (
  await vi.importActual<typeof import('../model/serialize-item.js')>(
    '../model/serialize-item.js',
  )
).serializeItem;

/** A text `serializeItem` refuses although `validateModel` finds nothing. */
const TOO_LARGE = 'too large to write';

beforeEach(() => {
  vi.mocked(serializeItem).mockReset();
  vi.mocked(serializeItem).mockImplementation((file, data, schema) => {
    if (JSON.stringify(data)?.includes(TOO_LARGE)) {
      throw new TypeError(
        `Cannot write ${file}: it is too large or too deeply nested to write`,
      );
    }
    return real(file, data, schema);
  });
});

const schemaError = (file: string, path: string): Issue => ({
  rule: 'schema',
  severity: 'error',
  file,
  path,
  message: `${path} must be a JSON value`,
});

const PREFIX = 'The command would break the model: ';

/** The entity `a` whose key names a missing attribute: one R02. */
const withR02 = () =>
  handModel({
    entities: [
      entityItem('a', {
        keys: [{ id: 'k', kind: 'primary', attributes: ['missing'] }],
      }),
    ],
  });

describe('검증 정책: 손댄 항목은 쓸 수 있게 남는다', () => {
  test("AC-07 (바), the rule itself: Codex's first case is refused although the count stays", () => {
    const editor = createEditor(withR02());
    expect(editor.issues.map((issue) => issue.rule)).toEqual(['R02']);
    const model = editor.model;
    const before = editor.issues;
    const result = editor.execute({
      type: 'entity.update',
      id: 'a',
      set: { ext: { wide: 2 ** 53 } },
    });
    expect(result).toEqual({
      ok: false,
      code: 'validation',
      message: `${PREFIX}Cannot write entities/a.yaml: /ext/wide must be a JSON value`,
      issues: [schemaError('entities/a.yaml', '/ext/wide')],
    });
    expect(editor.model).toBe(model);
    expect(editor.issues).toBe(before);
    expect(editor.canUndo).toBe(false);
  });

  test("AC-07, the rule itself: the re-check's case 1 is accepted, since x was unwritable before", () => {
    // (a) does not apply to x, which `serializeItem` refused before the
    // command; (b) decides: one error before (a.ext.wide), one after
    // (b.ext.wide, now at index 0). The model stays unwritable: the
    // caller's problem (spec 8).
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
    const start = editor.issues;
    expect(start).toEqual([
      schemaError('entities/x.yaml', '/attributes/0/ext/wide'),
    ]);
    const result = editor.execute(MOVE_ONTO_OLD_PLACE);
    expect(result.ok).toBe(true);
    expect(editor.issues).toEqual([
      schemaError('entities/x.yaml', '/attributes/0/ext/wide'),
    ]);
    expect(editor.model.entities[0]!.data.attributes[0]!.id).toBe('b');
    expect(() => serializeModel(editor.model)).toThrow(
      /\/attributes\/0\/ext\/wide must be a JSON value/,
    );
    // Without the last update the same batch repairs x.
    const other = createEditor(
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
    expect(
      other.execute({
        type: 'batch',
        commands: MOVE_ONTO_OLD_PLACE.commands.slice(0, 2),
      }).ok,
    ).toBe(true);
    expect(other.issues).toEqual([]);
    expect(() => serializeModel(other.model)).not.toThrow();
  });

  test('a batch that repairs one item and makes another unwritable is refused with that item', () => {
    const editor = createEditor(
      handModel({
        entities: [
          entityItem('a', { ext: { wide: 2 ** 53 } }),
          entityItem('b'),
        ],
      }),
    );
    const model = editor.model;
    expect(
      editor.execute({
        type: 'batch',
        commands: [
          { type: 'entity.update', id: 'a', unset: ['ext'] },
          { type: 'entity.update', id: 'b', set: { ext: { wide: 2 ** 53 } } },
        ],
      }),
    ).toEqual({
      ok: false,
      code: 'validation',
      message: `${PREFIX}Cannot write entities/b.yaml: /ext/wide must be a JSON value`,
      issues: [schemaError('entities/b.yaml', '/ext/wide')],
    });
    expect(editor.model).toBe(model);
  });

  test('a new item that cannot be written is refused', () => {
    const editor = createEditor(handModel());
    expect(
      editor.execute({
        type: 'entity.create',
        id: 'n',
        name: 'N',
        ext: { wide: -(2 ** 53) },
      }),
    ).toEqual({
      ok: false,
      code: 'validation',
      message: `${PREFIX}Cannot write entities/n.yaml: /ext/wide must be a JSON value`,
      issues: [schemaError('entities/n.yaml', '/ext/wide')],
    });
  });

  test('the first unwritable item in list order names the refusal; its file alone gives the issues', () => {
    const editor = createEditor(
      handModel({ entities: [entityItem('a'), entityItem('b')] }),
    );
    const result = editor.execute({
      type: 'batch',
      commands: [
        { type: 'entity.update', id: 'b', set: { ext: { wide: 2 ** 53 } } },
        { type: 'entity.update', id: 'a', set: { ext: { wide: 2 ** 54 } } },
      ],
    });
    expect(result).toEqual({
      ok: false,
      code: 'validation',
      message: `${PREFIX}Cannot write entities/a.yaml: /ext/wide must be a JSON value`,
      issues: [schemaError('entities/a.yaml', '/ext/wide')],
    });
  });

  test('an unwritable item validateModel finds nothing in is refused with no issues', () => {
    const editor = createEditor(handModel({ entities: [entityItem('a')] }));
    expect(
      editor.execute({
        type: 'entity.update',
        id: 'a',
        set: { note: TOO_LARGE },
      }),
    ).toEqual({
      ok: false,
      code: 'validation',
      message: `${PREFIX}Cannot write entities/a.yaml: it is too large or too deeply nested to write`,
      issues: [],
    });
  });

  test('an item unwritable before stays acceptable while the errors do not grow; repairing it is accepted', () => {
    const editor = createEditor(
      handModel({ entities: [entityItem('a', { note: TOO_LARGE })] }),
    );
    expect(editor.issues).toEqual([]);
    // Still unwritable, no error: (a) leaves it, (b) holds.
    expect(
      editor.execute({
        type: 'entity.update',
        id: 'a',
        set: { definition: 'd' },
      }).ok,
    ).toBe(true);
    expect(
      editor.execute({ type: 'entity.update', id: 'a', unset: ['note'] }).ok,
    ).toBe(true);
    expect(() => serializeModel(editor.model)).not.toThrow();
  });

  test('only touched items are serialized, each item before the command at most once', () => {
    const editor = createEditor(
      handModel({
        entities: [
          entityItem('a', { note: TOO_LARGE }),
          entityItem('b', { note: TOO_LARGE }),
          entityItem('c'),
        ],
      }),
    );
    vi.mocked(serializeItem).mockClear();
    const result = editor.execute({
      type: 'batch',
      commands: [
        { type: 'entity.update', id: 'b', set: { definition: 'd1' } },
        { type: 'entity.update', id: 'b', set: { definition: 'd2' } },
        { type: 'entity.update', id: 'c', set: { definition: 'd' } },
      ],
    });
    expect(result.ok).toBe(true);
    const files = vi
      .mocked(serializeItem)
      .mock.calls.map(([file]) => file)
      .sort();
    // b and c at the end, and once each as they were before; never a.
    expect(files).toEqual([
      'entities/b.yaml',
      'entities/b.yaml',
      'entities/c.yaml',
      'entities/c.yaml',
    ]);
  });
});
