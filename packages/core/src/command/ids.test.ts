import { describe, expect, test } from 'vitest';
import {
  EMPTY_MANIFEST,
  emptyModel,
  entityItem,
  handModel,
  loadFiles,
} from '../testing/editing.js';
import { AWKWARD_STRINGS, Random, randomString } from '../testing/generate.js';
import { createEditor } from './editor.js';
import {
  chooseId,
  idBase,
  idProblem,
  type IdSpace,
  type Physical,
} from './ids.js';
import {
  fileSpace,
  InitialPaths,
  newItemFile,
  type NewItemFolder,
  pathKeys,
} from './paths.js';

interface Placed {
  id: string;
  physical?: Physical;
  /** The item's file when it is not `<folder>/<id>.yaml`. */
  file?: string;
}

interface Setup {
  items?: readonly Placed[];
  dir?: string;
  reserved?: readonly string[];
  /** Initial paths; by default the files of `items`. */
  initial?: readonly string[];
  /** Other paths in use (the manifest, other lists). */
  others?: readonly string[];
  dictionaryFolders?: readonly string[];
}

/** An id space over sets, recording every candidate it is asked about. */
function placedSpace(
  kind: 'entity' | 'subject area',
  setup: Setup = {},
): { space: IdSpace; asked: string[] } {
  const dir = setup.dir ?? '';
  const folder: NewItemFolder =
    kind === 'entity' ? 'entities' : 'subject-areas';
  const items = setup.items ?? [];
  const files = items.map(
    (item) => item.file ?? newItemFile(dir, folder, item.id),
  );
  const ids = new Set(items.map((item) => item.id));
  const physicals = new Map<string, (Physical | undefined)[]>();
  for (const item of items) {
    const list = physicals.get(item.id) ?? [];
    list.push(item.physical);
    physicals.set(item.id, list);
  }
  const asked: string[] = [];
  const files$ = fileSpace({
    dir,
    folder,
    used: pathKeys([
      ...files,
      ...(setup.reserved ?? []),
      ...(setup.others ?? []),
    ]),
    initial: new InitialPaths(setup.initial ?? files),
    dictionaryFolders: setup.dictionaryFolders ?? ['dictionary'],
  });
  const hasId = (id: string) => {
    asked.push(id);
    return ids.has(id);
  };
  const space: IdSpace =
    kind === 'entity'
      ? {
          kind,
          hasId,
          physicalsOf: (id) => physicals.get(id) ?? [],
          files: files$,
        }
      : { kind, hasId, files: files$ };
  return { space, asked };
}

function memberSpace(kind: 'attribute' | 'key', ids: readonly string[]) {
  const set = new Set(ids);
  const asked: string[] = [];
  const space: IdSpace = {
    kind,
    entity: 'order',
    hasId: (id) => {
      asked.push(id);
      return set.has(id);
    },
  };
  return { space, asked };
}

const chosen = (id: string) => ({ ok: true, id });
const refused = (message: string) => ({ ok: false, message });

describe('ID 만들기', () => {
  describe('재료', () => {
    test('entity and attribute: physical.name, then name when that slug is empty, then the word', () => {
      for (const kind of ['entity', 'attribute'] as const) {
        expect(
          idBase({ kind, name: '고객', physicalName: 'CUSTOMER_V2' }),
        ).toBe('customer_v2');
        expect(idBase({ kind, name: '고객', physicalName: '___' })).toBe(
          'gogaek',
        );
        expect(idBase({ kind, name: '고객' })).toBe('gogaek');
      }
      for (const name of [
        '漢字',
        '🙂',
        '___',
        '   ',
        `${' '.repeat(256)}abc`,
      ]) {
        expect(idBase({ kind: 'entity', name })).toBe('entity');
        expect(idBase({ kind: 'attribute', name, physicalName: '🙂' })).toBe(
          'attribute',
        );
      }
    });

    test('key: physical.name, name, then the word of its kind', () => {
      expect(
        idBase({
          kind: 'key',
          keyKind: 'primary',
          name: 'Main',
          physicalName: 'PK_ORDER',
        }),
      ).toBe('pk_order');
      expect(idBase({ kind: 'key', keyKind: 'primary', name: 'Main' })).toBe(
        'main',
      );
      expect(idBase({ kind: 'key', keyKind: 'primary' })).toBe('pk');
      expect(idBase({ kind: 'key', keyKind: 'alternate', name: '___' })).toBe(
        'ak',
      );
      expect(
        idBase({ kind: 'key', keyKind: 'inversion', physicalName: '漢字' }),
      ).toBe('ie');
    });

    test('subject area: name, then area', () => {
      expect(idBase({ kind: 'subject area', name: 'Sales 2' })).toBe('sales_2');
      for (const name of ['漢字', '🙂', '___', ' ']) {
        expect(idBase({ kind: 'subject area', name })).toBe('area');
      }
    });

    test('awkward and random names never throw', () => {
      const random = new Random(5);
      const names = [...AWKWARD_STRINGS, '\ud800', 'x'.repeat(1_000_000)];
      for (let i = 0; i < 500; i += 1) names.push(randomString(random));
      for (const name of names) {
        expect(idBase({ kind: 'entity', name, physicalName: name })).toMatch(
          /^[a-z0-9][a-z0-9_]{0,62}$/,
        );
      }
    });
  });

  describe('후보의 순서', () => {
    test('the slug, then _2, _3: the same name three times', () => {
      const items: Placed[] = [];
      const made: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const { space } = placedSpace('entity', { items });
        const result = chooseId(space, 'x', {});
        if (!result.ok) throw new Error(result.message);
        made.push(result.id);
        items.push({ id: result.id });
      }
      expect(made).toEqual(['x', 'x_2', 'x_3']);
    });

    test('a suffix that makes more than 63 characters cuts the end of the base', () => {
      const a63 = 'a'.repeat(63);
      const { space } = placedSpace('entity', { items: [{ id: a63 }] });
      expect(chooseId(space, a63)).toEqual(chosen(`${'a'.repeat(61)}_2`));
      // Cut to 61 characters, the base ends in `_`, which is dropped.
      const base = `${'a'.repeat(60)}_bc`;
      const cut = placedSpace('entity', { items: [{ id: base }] });
      expect(chooseId(cut.space, base)).toEqual(chosen(`${'a'.repeat(60)}_2`));
    });

    test('ten and more suffixes cut one more character', () => {
      const base = 'b'.repeat(63);
      const ids = [base];
      for (let n = 2; n <= 9; n += 1) ids.push(`${'b'.repeat(61)}_${n}`);
      const { space } = memberSpace('attribute', ids);
      expect(chooseId(space, base)).toEqual(chosen(`${'b'.repeat(60)}_10`));
    });

    test('a fourth x among x, x_2, x_3 asks about four candidates', () => {
      const { space, asked } = memberSpace('attribute', ['x', 'x_2', 'x_3']);
      expect(chooseId(space, 'x')).toEqual(chosen('x_4'));
      expect(asked).toEqual(['x', 'x_2', 'x_3', 'x_4']);
    });
  });

  describe('스키마 접두', () => {
    const member: Placed = {
      id: 'member',
      physical: { name: 'MEMBER', schema: 'main' },
    };

    test('(가) the same table name in another schema: <schema>_<slug>', () => {
      const { space } = placedSpace('entity', { items: [member] });
      expect(
        chooseId(space, 'member', { name: 'MEMBER', schema: 'dormant' }),
      ).toEqual(chosen('dormant_member'));
    });

    test('(나) the prefixed id taken by a reserved path: the suffixes start from it', () => {
      const { space } = placedSpace('entity', {
        items: [member],
        reserved: ['entities/dormant_member.yaml'],
      });
      expect(
        chooseId(space, 'member', { name: 'MEMBER', schema: 'dormant' }),
      ).toEqual(chosen('dormant_member_2'));
    });

    test('(다) no schema on the new entity: its slug is empty, no prefix', () => {
      const { space } = placedSpace('entity', { items: [member] });
      expect(chooseId(space, 'member', { name: 'MEMBER' })).toEqual(
        chosen('member_2'),
      );
    });

    test('(라) a schema whose slug is empty: no prefix', () => {
      const { space } = placedSpace('entity', { items: [member] });
      expect(
        chooseId(space, 'member', { name: 'MEMBER', schema: '!!' }),
      ).toEqual(chosen('member_2'));
    });

    test('(마) a table name in other letters: no prefix', () => {
      const { space } = placedSpace('entity', { items: [member] });
      expect(
        chooseId(space, 'member', { name: 'Member', schema: 'dormant' }),
      ).toEqual(chosen('member_2'));
    });

    test('(바) neither has a table name: no prefix whatever the schemas', () => {
      const { space } = placedSpace('entity', {
        items: [{ id: 'member', physical: { schema: 'main' } }],
      });
      expect(chooseId(space, 'member', { schema: 'dormant' })).toEqual(
        chosen('member_2'),
      );
      const bare = placedSpace('entity', { items: [{ id: 'member' }] });
      expect(chooseId(bare.space, 'member', { schema: 'dormant' })).toEqual(
        chosen('member_2'),
      );
    });

    test('the same schema, or a missing one on both: no prefix', () => {
      const { space } = placedSpace('entity', { items: [member] });
      expect(
        chooseId(space, 'member', { name: 'MEMBER', schema: 'main' }),
      ).toEqual(chosen('member_2'));
      const none = placedSpace('entity', {
        items: [{ id: 'member', physical: { name: 'MEMBER' } }],
      });
      expect(
        chooseId(none.space, 'member', { name: 'MEMBER', schema: '' }),
      ).toEqual(chosen('member_2'));
    });

    test('an entity with that table name under another id does not prefix', () => {
      const { space } = placedSpace('entity', {
        items: [
          { id: 'member', physical: { name: 'OTHER', schema: 'main' } },
          { id: 'renamed', physical: { name: 'MEMBER', schema: 'main' } },
        ],
      });
      expect(
        chooseId(space, 'member', { name: 'MEMBER', schema: 'dormant' }),
      ).toEqual(chosen('member_2'));
    });

    test('two entities with the slug as id: either one matching prefixes', () => {
      const { space } = placedSpace('entity', {
        items: [
          { id: 'member' },
          { id: 'member', physical: { name: 'MEMBER', schema: 'main' } },
        ],
      });
      expect(
        chooseId(space, 'member', { name: 'MEMBER', schema: 'dormant' }),
      ).toEqual(chosen('dormant_member'));
    });

    test('a long prefixed id is cut to 63 characters', () => {
      const base = 'm'.repeat(60);
      const { space } = placedSpace('entity', {
        items: [{ id: base, physical: { name: 'T', schema: 'a' } }],
      });
      expect(chooseId(space, base, { name: 'T', schema: 'Archive' })).toEqual(
        chosen(`archive_${'m'.repeat(55)}`),
      );
    });

    test('(아) candidates that come again after cutting are not asked again', () => {
      const s = `${'2_'.repeat(30)}2`;
      expect(s).toHaveLength(61);
      const items: Placed[] = [
        { id: `${s}_3`, physical: { name: `${s}_3`, schema: 'main' } },
        { id: `${s}_2` },
      ];
      const { space, asked } = placedSpace('entity', { items });
      const base = idBase({
        kind: 'entity',
        name: 'x',
        physicalName: `${s}_3`,
      });
      expect(base).toBe(`${s}_3`);
      expect(chooseId(space, base, { name: `${s}_3`, schema: '2' })).toEqual(
        chosen(`${s}_4`),
      );
      expect(asked).toEqual([`${s}_3`, `${s}_2`, `${s}_4`]);
      expect(new Set(asked).size).toBe(asked.length);
      // FR-10: the ids of the namespace + reserved and initial paths + 2.
      expect(asked.length).toBeLessThanOrEqual(items.length + items.length + 2);
    });
  });

  describe('쓸 수 없는 ID', () => {
    test('1. used in the namespace, in the words of each namespace', () => {
      expect(
        idProblem(placedSpace('entity', { items: [{ id: 'a' }] }).space, 'a'),
      ).toBe('entity id "a" is already used');
      expect(
        idProblem(
          placedSpace('subject area', { items: [{ id: 'a' }] }).space,
          'a',
        ),
      ).toBe('subject area id "a" is already used');
      expect(idProblem(memberSpace('attribute', ['a']).space, 'a')).toBe(
        'attribute id "a" is already used in entity "order"',
      );
      expect(idProblem(memberSpace('key', ['a']).space, 'a')).toBe(
        'key id "a" is already used in entity "order"',
      );
      expect(idProblem(memberSpace('key', ['a']).space, 'b')).toBeUndefined();
    });

    test('2. reserved file names on Windows: entities and subject areas only', () => {
      const names = ['con', 'prn', 'aux', 'nul'];
      for (let n = 0; n <= 9; n += 1) names.push(`com${n}`, `lpt${n}`);
      for (const id of names) {
        for (const kind of ['entity', 'subject area'] as const) {
          expect(idProblem(placedSpace(kind).space, id)).toBe(
            `${kind} id "${id}" cannot be used: it is a reserved file name on Windows`,
          );
        }
        expect(
          idProblem(memberSpace('attribute', []).space, id),
        ).toBeUndefined();
        expect(idProblem(memberSpace('key', []).space, id)).toBeUndefined();
      }
      for (const id of ['con_2', 'com10', 'lpt', 'nul-1', 'console']) {
        expect(idProblem(placedSpace('entity').space, id)).toBeUndefined();
      }
    });

    test('generated: CON is con_2 for entities and subject areas, con for attributes', () => {
      expect(chooseId(placedSpace('entity').space, 'con')).toEqual(
        chosen('con_2'),
      );
      expect(chooseId(placedSpace('subject area').space, 'con')).toEqual(
        chosen('con_2'),
      );
      expect(chooseId(memberSpace('attribute', []).space, 'con')).toEqual(
        chosen('con'),
      );
    });

    test('3. inside the dictionary folder', () => {
      const { space } = placedSpace('entity', {
        dictionaryFolders: ['entities'],
      });
      expect(idProblem(space, 'customer')).toBe(
        'entity id "customer" cannot be used: entities/customer.yaml is inside the dictionary folder entities',
      );
      const root = placedSpace('subject area', {
        dir: 'm',
        dictionaryFolders: [''],
      });
      expect(idProblem(root.space, 'sales')).toBe(
        'subject area id "sales" cannot be used: m/subject-areas/sales.yaml is inside the dictionary folder .',
      );
    });

    test('3. a generated id is refused at its first candidate, even one taken', () => {
      const { space, asked } = placedSpace('entity', {
        dictionaryFolders: ['entities'],
      });
      expect(chooseId(space, 'customer')).toEqual(
        refused(
          'entity id "customer" cannot be used: entities/customer.yaml is inside the dictionary folder entities',
        ),
      );
      expect(asked).toEqual([]);
      const taken = placedSpace('entity', {
        items: [{ id: 'customer' }],
        dictionaryFolders: ['entities'],
      });
      expect(chooseId(taken.space, 'customer')).toEqual(
        refused(
          'entity id "customer" cannot be used: entities/customer.yaml is inside the dictionary folder entities',
        ),
      );
    });

    test('4. the path is in use: an item of another id or other letters, a reserved path', () => {
      const other = placedSpace('entity', {
        items: [{ id: 'cust', file: 'entities/Customer.yaml' }],
      });
      expect(idProblem(other.space, 'customer')).toBe(
        'entity id "customer" cannot be used: entities/customer.yaml is already in use',
      );
      expect(chooseId(other.space, 'customer')).toEqual(chosen('customer_2'));
      const reserved = placedSpace('entity', {
        reserved: ['entities/tag_2.yaml'],
      });
      expect(idProblem(reserved.space, 'tag_2')).toBe(
        'entity id "tag_2" cannot be used: entities/tag_2.yaml is already in use',
      );
      expect(chooseId(reserved.space, 'tag_2')).toEqual(chosen('tag_2_2'));
      const billing = placedSpace('subject area', {
        dir: 'billing',
        others: ['billing/subject-areas/S.yaml'],
      });
      expect(idProblem(billing.space, 's')).toBe(
        'subject area id "s" cannot be used: billing/subject-areas/s.yaml is already in use',
      );
    });

    test('5. another letter case was loaded: the first initial path in code unit order', () => {
      // The entity of `entities/Customer.yaml` was deleted: its id and path are free.
      const one = placedSpace('entity', {
        initial: ['entities/Customer.yaml'],
      });
      expect(idProblem(one.space, 'customer')).toBe(
        'entity id "customer" cannot be used: a file with another letter case was loaded: entities/Customer.yaml',
      );
      expect(chooseId(one.space, 'customer')).toEqual(chosen('customer_2'));
      const same = placedSpace('entity', {
        initial: ['entities/customer.yaml'],
      });
      expect(idProblem(same.space, 'customer')).toBeUndefined();
      // Every item gone, an exact initial path among them: the others are named.
      const freed = placedSpace('entity', {
        initial: [
          'entities/customer.yaml',
          'entities/cUstomer.yaml',
          'entities/Customer.yaml',
        ],
      });
      expect(idProblem(freed.space, 'customer')).toBe(
        'entity id "customer" cannot be used: a file with another letter case was loaded: entities/Customer.yaml',
      );
    });

    test('the first reason wins: 1 over 2 over 3 over the path reasons', () => {
      const all = placedSpace('entity', {
        items: [{ id: 'nul' }],
        initial: ['entities/NUL.yaml', 'entities/nul.yaml'],
        dictionaryFolders: ['entities'],
      });
      expect(idProblem(all.space, 'nul')).toBe(
        'entity id "nul" is already used',
      );
      const two = placedSpace('entity', {
        initial: ['entities/NUL.yaml'],
        reserved: ['entities/nul.yaml'],
        dictionaryFolders: ['entities'],
      });
      expect(idProblem(two.space, 'nul')).toBe(
        'entity id "nul" cannot be used: it is a reserved file name on Windows',
      );
      const three = placedSpace('entity', {
        initial: ['entities/X.yaml'],
        reserved: ['entities/x.yaml'],
        dictionaryFolders: ['entities'],
      });
      expect(idProblem(three.space, 'x')).toBe(
        'entity id "x" cannot be used: entities/x.yaml is inside the dictionary folder entities',
      );
      const four = placedSpace('entity', {
        initial: ['entities/X.yaml'],
        reserved: ['entities/x.yaml'],
      });
      expect(idProblem(four.space, 'x')).toBe(
        'entity id "x" cannot be used: entities/x.yaml is already in use',
      );
    });

    test('AC-09: with Customer, cUstomer and customer loaded, deleting only customer hits reason 4 before 5', () => {
      const initial = [
        'entities/Customer.yaml',
        'entities/cUstomer.yaml',
        'entities/customer.yaml',
      ];
      const onlyCustomer = placedSpace('entity', {
        items: [
          { id: 'a', file: 'entities/Customer.yaml' },
          { id: 'b', file: 'entities/cUstomer.yaml' },
        ],
        initial,
      });
      expect(idProblem(onlyCustomer.space, 'customer')).toBe(
        'entity id "customer" cannot be used: entities/customer.yaml is already in use',
      );
      const allThree = placedSpace('entity', { initial });
      expect(idProblem(allThree.space, 'customer')).toBe(
        'entity id "customer" cannot be used: a file with another letter case was loaded: entities/Customer.yaml',
      );
    });

    test('a given id is checked as given, without prefix or suffix', () => {
      const { space, asked } = placedSpace('entity', {
        items: [{ id: 'member', physical: { name: 'MEMBER', schema: 'main' } }],
      });
      expect(idProblem(space, 'member')).toBe(
        'entity id "member" is already used',
      );
      expect(asked).toEqual(['member']);
    });
  });

  describe('이름 공간', () => {
    test('entities and subject areas, and each entity attributes and keys, are apart', () => {
      const entities = placedSpace('entity', { items: [{ id: 'sales' }] });
      const areas = placedSpace('subject area', { items: [{ id: 'other' }] });
      expect(idProblem(entities.space, 'sales')).toBeDefined();
      expect(idProblem(areas.space, 'sales')).toBeUndefined();
      expect(
        idProblem(memberSpace('attribute', ['a']).space, 'b'),
      ).toBeUndefined();
      expect(idProblem(memberSpace('key', ['b']).space, 'a')).toBeUndefined();
    });

    test('built-in property names are ids like any other', () => {
      for (const id of ['constructor', 'proto', 'tostring', 'hasownproperty']) {
        expect(chooseId(placedSpace('entity').space, id)).toEqual(chosen(id));
        expect(
          idProblem(memberSpace('attribute', []).space, id),
        ).toBeUndefined();
      }
      expect(
        chooseId(
          placedSpace('entity', { items: [{ id: 'constructor' }] }).space,
          'constructor',
        ),
      ).toEqual(chosen('constructor_2'));
    });
  });
});

describe('ID 만들기', () => {
  describe('편집기에서', () => {
    /** The id a create of `kind` makes in a fresh editor of the empty model. */
    async function created(command: Record<string, unknown>): Promise<unknown> {
      const editor = createEditor(await emptyModel());
      editor.execute({ type: 'entity.create', id: 'e', name: 'E' });
      editor.execute({
        type: 'attribute.create',
        entity: 'e',
        id: 'k',
        name: 'K',
      });
      const result = editor.execute(command);
      expect(editor.issues).toEqual([]);
      return result.ok ? result.id : result;
    }
    const entity = (name: string, extra: object = {}) =>
      created({ type: 'entity.create', name, ...extra });

    test('names give the ids of AC-08', async () => {
      const cases: [string, string][] = [
        ['Order Item', 'order_item'],
        ['ORD_NO', 'ord_no'],
        ['고객', 'gogaek'],
        ['주문번호', 'jumunbeonho'],
        ['값', 'gaps'],
        ['닭', 'dalk'],
        ['읽기', 'ilkgi'],
        ['엔터티', 'enteoti'],
        ['  __proto__  ', 'proto'],
        ['constructor', 'constructor'],
        ['ＡＢＣ１', 'abc1'],
        ['café', 'caf'],
        ['a--b__c', 'a_b_c'],
        ['123', '123'],
        ['a'.repeat(70), 'a'.repeat(63)],
        ['값'.repeat(20), `${'gaps'.repeat(15)}gap`],
        [`${' '.repeat(256)}abc`, 'entity'],
      ];
      for (const [name, id] of cases) expect(await entity(name)).toBe(id);
    });

    test('names with no letter give the word of their kind', async () => {
      for (const name of ['漢字', '🙂', '___', '   ']) {
        expect(await entity(name)).toBe('entity');
        expect(
          await created({ type: 'attribute.create', entity: 'e', name }),
        ).toBe('attribute');
        expect(await created({ type: 'subjectArea.create', name })).toBe(
          'area',
        );
      }
      const keys: [string, string][] = [
        ['primary', 'pk'],
        ['alternate', 'ak'],
        ['inversion', 'ie'],
      ];
      for (const [kind, id] of keys) {
        expect(
          await created({
            type: 'key.create',
            entity: 'e',
            kind,
            attributes: ['k'],
          }),
        ).toBe(id);
      }
    });

    test('physical.name first, the name when its slug is empty', async () => {
      expect(await entity('고객', { physical: { name: 'CUSTOMER_V2' } })).toBe(
        'customer_v2',
      );
      expect(await entity('고객', { physical: { name: '___' } })).toBe(
        'gogaek',
      );
    });

    test('the same name three times, after 63 a, and deleted then made again', async () => {
      const editor = createEditor(await emptyModel());
      const make = (name: string) => {
        const result = editor.execute({ type: 'entity.create', name });
        return result.ok ? result.id : result;
      };
      expect([make('x'), make('x'), make('x')]).toEqual(['x', 'x_2', 'x_3']);
      expect(make('a'.repeat(63))).toBe('a'.repeat(63));
      expect(make('a'.repeat(63))).toBe(`${'a'.repeat(61)}_2`);
      expect(editor.execute({ type: 'entity.delete', id: 'x_2' }).ok).toBe(
        true,
      );
      expect(make('x')).toBe('x_2');
      expect(editor.issues).toEqual([]);
    });

    test('CON is con_2 for entities and subject areas, con for attributes', async () => {
      expect(await entity('CON')).toBe('con_2');
      expect(await created({ type: 'subjectArea.create', name: 'CON' })).toBe(
        'con_2',
      );
      expect(
        await created({ type: 'attribute.create', entity: 'e', name: 'CON' }),
      ).toBe('con');
    });

    test('an entity and a subject area may share an id', async () => {
      const editor = createEditor(await emptyModel());
      expect(
        editor.execute({ type: 'entity.create', name: 'sales' }),
      ).toMatchObject({ ok: true, id: 'sales' });
      expect(
        editor.execute({ type: 'subjectArea.create', name: 'sales' }),
      ).toMatchObject({ ok: true, id: 'sales' });
    });

    describe('스키마 접두', () => {
      const memberModel = () =>
        createEditor(
          handModel({
            entities: [
              entityItem('member', {
                physical: { name: 'MEMBER', schema: 'main' },
              }),
            ],
          }),
          { reservedFiles: [] },
        );
      const make = (
        physical: object | undefined,
        reservedFiles: string[] = [],
        name = 'member',
      ) => {
        const editor = createEditor(
          handModel({
            entities: [
              entityItem('member', {
                physical: { name: 'MEMBER', schema: 'main' },
              }),
            ],
          }),
          { reservedFiles },
        );
        const result = editor.execute({
          type: 'entity.create',
          name,
          ...(physical ? { physical } : {}),
        });
        expect(editor.issues).toEqual([]);
        return result.ok ? result.id : result;
      };

      test('(가) to (마) of AC-08', () => {
        expect(make({ name: 'MEMBER', schema: 'dormant' })).toBe(
          'dormant_member',
        );
        expect(
          make({ name: 'MEMBER', schema: 'dormant' }, [
            'entities/dormant_member.yaml',
          ]),
        ).toBe('dormant_member_2');
        expect(make({ name: 'MEMBER' })).toBe('member_2');
        expect(make({ name: 'MEMBER', schema: '!!' })).toBe('member_2');
        expect(make({ name: 'Member', schema: 'dormant' })).toBe('member_2');
      });

      test('(바) neither has a table name; (사) a given id is id-taken', () => {
        const editor = createEditor(
          handModel({ entities: [entityItem('member')] }),
        );
        expect(
          editor.execute({
            type: 'entity.create',
            name: 'member',
            physical: { schema: 'dormant' },
          }),
        ).toMatchObject({ ok: true, id: 'member_2' });
        expect(
          memberModel().execute({
            type: 'entity.create',
            id: 'member',
            name: 'member',
            physical: { name: 'MEMBER', schema: 'dormant' },
          }),
        ).toEqual({
          ok: false,
          code: 'id-taken',
          message: 'entity id "member" is already used',
          issues: [],
        });
      });

      test('(아) candidates that come again after cutting: s_4', () => {
        const s = `${'2_'.repeat(30)}2`;
        const editor = createEditor(
          handModel({
            entities: [
              entityItem(`${s}_3`, {
                physical: { name: `${s}_3`, schema: 'main' },
              }),
              entityItem(`${s}_2`),
            ],
          }),
        );
        expect(
          editor.execute({
            type: 'entity.create',
            name: 'x',
            physical: { name: `${s}_3`, schema: '2' },
          }),
        ).toMatchObject({ ok: true, id: `${s}_4` });
        expect(editor.issues).toEqual([]);
      });
    });

    test('a given id: the five reasons in the words of appendix B, the first that applies', async () => {
      const refusal = (message: string) => ({
        ok: false,
        code: 'id-taken',
        message,
        issues: [],
      });
      const create = (id: string) => ({ type: 'entity.create', id, name: 'N' });

      const used = createEditor(
        handModel({
          entities: [
            entityItem('x'),
            entityItem('nul'),
            entityItem('q', {}, 'entities/Y.yaml'),
          ],
        }),
        { reservedFiles: ['entities/r.yaml'] },
      );
      expect(used.execute(create('x'))).toEqual(
        refusal('entity id "x" is already used'),
      );
      // Used and a Windows name: reason 1.
      expect(used.execute(create('nul'))).toEqual(
        refusal('entity id "nul" is already used'),
      );
      expect(used.execute(create('con'))).toEqual(
        refusal(
          'entity id "con" cannot be used: it is a reserved file name on Windows',
        ),
      );
      expect(used.execute(create('r'))).toEqual(
        refusal(
          'entity id "r" cannot be used: entities/r.yaml is already in use',
        ),
      );
      expect(used.execute(create('y'))).toEqual(
        refusal(
          'entity id "y" cannot be used: entities/y.yaml is already in use',
        ),
      );
      expect(used.execute({ type: 'entity.delete', id: 'q' }).ok).toBe(true);
      expect(used.execute(create('y'))).toEqual(
        refusal(
          'entity id "y" cannot be used: a file with another letter case was loaded: entities/Y.yaml',
        ),
      );
      expect(
        used.execute({
          type: 'attribute.create',
          entity: 'x',
          id: 'a',
          name: 'A',
        }).ok,
      ).toBe(true);
      expect(
        used.execute({
          type: 'attribute.create',
          entity: 'x',
          id: 'a',
          name: 'A',
        }),
      ).toEqual(refusal('attribute id "a" is already used in entity "x"'));
      expect(
        used.execute({
          type: 'key.create',
          entity: 'x',
          id: 'pk',
          kind: 'primary',
          attributes: ['a'],
        }).ok,
      ).toBe(true);
      expect(
        used.execute({
          type: 'key.create',
          entity: 'x',
          id: 'pk',
          kind: 'alternate',
          attributes: ['a'],
        }),
      ).toEqual(refusal('key id "pk" is already used in entity "x"'));
      expect(
        used.execute({ type: 'subjectArea.create', id: 'prn', name: 'P' }),
      ).toEqual(
        refusal(
          'subject area id "prn" cannot be used: it is a reserved file name on Windows',
        ),
      );

      const dictionary = createEditor(
        await loadFiles({
          'model.yaml': `${EMPTY_MANIFEST}dictionaries:\n  - entities\n`,
        }),
      );
      expect(dictionary.execute(create('x'))).toEqual(
        refusal(
          'entity id "x" cannot be used: entities/x.yaml is inside the dictionary folder entities',
        ),
      );
    });
  });
});
