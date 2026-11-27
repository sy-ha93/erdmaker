import { describe, expect, test } from 'vitest';
import { loadModel } from '../model/load.js';
import type { EntityData, Issue, Model, ModelItem } from '../model/types.js';
import { bigModel, brokenCount, type Sizes } from '../testing/big-model.js';
import { caseFiles, RULE_CASES, type RuleCase } from '../testing/cases.js';
import {
  exampleFileSystem,
  exampleFiles,
  type Files,
  replaceOnce,
} from '../testing/example.js';
import { validateModel } from './index.js';
import { finishIssues } from './issues.js';

/** Reads the files from disk-like memory and validates the model, as `validateProject` does. */
async function check(files: Files, modelDir = '') {
  const loaded = await loadModel(exampleFileSystem(files), modelDir);
  const issues = finishIssues([
    ...loaded.issues,
    ...validateModel(loaded.model, loaded.positions),
  ]);
  return { ...loaded, issues };
}

const RULES = [
  'R01',
  'R02',
  'R03',
  'R04',
  'R05',
  'R06',
  'R07',
  'R08',
  'R09',
  'R10',
  'R11',
  'R12',
];

/** Appendix A: row → its rule and the shape of its message. */
const ROWS = new Map<number, [Issue['rule'], RegExp]>([
  [
    1,
    [
      'R01',
      /^duplicate (entity|relationship|subtype|subject area|word|term|domain) id ".+" \(also in .+\)$/,
    ],
  ],
  [2, ['R02', /^term ".+": unknown word ".+"$/]],
  [3, ['R02', /^term ".+": unknown domain ".+"$/]],
  [4, ['R10', /^duplicate schema ".+"$/]],
  [5, ['R12', /^duplicate area group id ".+"$/]],
  [6, ['R10', /^physical\.schema ".+" is not listed in model\.yaml$/]],
  [7, ['R11', /^table name ".+" is already used by ".+" in the same schema$/]],
  [8, ['R12', /^unknown area group ".+"$/]],
  [
    9,
    [
      'R01',
      /^member id ".+" clashes with another relationship or subtype member$/,
    ],
  ],
  [10, ['R01', /^duplicate attribute id ".+"$/]],
  [11, ['R02', /^attribute ".+": unknown domain ".+"$/]],
  [12, ['R02', /^attribute ".+": unknown term ".+"$/]],
  [13, ['R08', /^attribute ".+": scope is wider than its entity's$/]],
  [14, ['R02', /^attribute ".+": unknown relationship ".+"$/]],
  [
    15,
    ['R04', /^attribute ".+": ".+" does not have this entity as its child$/],
  ],
  [
    16,
    ['R04', /^attribute ".+": a many-to-many relationship migrates nothing$/],
  ],
  [17, ['R02', /^attribute ".+": parent ".+" has no attribute ".+"$/]],
  [18, ['R06', /^attribute ".+": type differs from .+\..+$/]],
  [
    19,
    [
      'R06',
      /^attribute ".+": name differs from .+\..+ but rolenamed is not set$/,
    ],
  ],
  [20, ['R07', /^attribute ".+": a recursive relationship needs a rolename$/]],
  [21, ['R01', /^duplicate key id ".+"$/]],
  [22, ['R02', /^key ".+": unknown attribute ".+"$/]],
  [23, ['R03', /^more than one primary key$/]],
  [24, ['R02', /^".+": unknown (parent|child) entity ".+"$/]],
  [25, ['R08', /^".+": scope is wider than its (parent|child) entity's$/]],
  [
    26,
    [
      'R04',
      /^".+": (parentKey ".+" must be an alternate key of ".+"|parent ".+" has no primary key to migrate)$/,
    ],
  ],
  [
    27,
    [
      'R04',
      /^".+": .+\..+ must migrate to exactly one attribute of ".+" \(found \d+\)$/,
    ],
  ],
  [28, ['R05', /^".+": .+\..+ must be part of the child's primary key$/]],
  [
    29,
    [
      'R05',
      /^".+": non-identifying, but .+\..+ is the child's whole primary key$/,
    ],
  ],
  [30, ['R02', /^unknown resolvedBy entity ".+"$/]],
  [31, ['R02', /^supertype ".+" has no attribute ".+"$/]],
  [32, ['R02', /^unknown entity ".+"$/]],
  [33, ['R09', /^second layout for (subject area ".+"|the whole model)$/]],
  [34, ['R09', /^unknown subject area ".+"$/]],
  [35, ['R09', /^node for unknown entity ".+"$/]],
  [36, ['R09', /^entity ".+" is not in subject area ".+"$/]],
  [37, ['R09', /^edge for unknown relationship ".+"$/]],
  [
    38,
    [
      'R04',
      /^attribute ".+": .+\..+ is not part of the key that ".+" migrates$/,
    ],
  ],
]);

const casesOf = (row: number) =>
  RULE_CASES.filter((rule) => rule.rows.includes(row));

const messagesOf = (row: number) =>
  casesOf(row).flatMap((rule) => rule.issues.map((issue) => issue.message));

describe('규칙 사례', () => {
  test.each(RULE_CASES.map((rule): [string, RuleCase] => [rule.name, rule]))(
    '%s',
    async (_name, rule) => {
      const { issues } = await check(caseFiles(rule));
      expect(issues).toEqual(rule.issues);
    },
  );

  test('the example has no issues, warnings included', async () => {
    const { issues } = await check(
      caseFiles({ name: '', rows: [], changes: [], issues: [] }),
    );
    expect(issues).toEqual([]);
  });

  test('the cases give every rule R01 to R12', () => {
    const rules = new Set(
      RULE_CASES.flatMap((rule) => rule.issues.map((issue) => issue.rule)),
    );
    expect(RULES.filter((id) => !rules.has(id as Issue['rule']))).toEqual([]);
  });

  test('every row 1 to 38 of Appendix A has a case with its rule and message', () => {
    const missing: number[] = [];
    for (const [row, [rule, pattern]] of ROWS) {
      const found = casesOf(row).some((c) =>
        c.issues.some(
          (issue) => issue.rule === rule && pattern.test(issue.message),
        ),
      );
      if (!found) missing.push(row);
    }
    expect(ROWS.size).toBe(38);
    expect(missing).toEqual([]);
  });

  test('row 1 has all seven kinds, row 26 all three messages, row 33 both', () => {
    const kinds = new Set(
      messagesOf(1).flatMap((message) => {
        const kind = /^duplicate (.+) id "/.exec(message)?.[1];
        return kind ? [kind] : [];
      }),
    );
    expect([...kinds].sort()).toEqual([
      'domain',
      'entity',
      'relationship',
      'subject area',
      'subtype',
      'term',
      'word',
    ]);
    const row26 = messagesOf(26);
    expect(row26.some((m) => /has no key ".+" to migrate$/.test(m))).toBe(true);
    expect(
      row26.some((m) => /parentKey ".+" must be an alternate key of /.test(m)),
    ).toBe(true);
    expect(row26.some((m) => /has no primary key to migrate$/.test(m))).toBe(
      true,
    );
    const row33 = messagesOf(33);
    expect(row33.some((m) => /^second layout for subject area "/.test(m))).toBe(
      true,
    );
    expect(row33).toContain('second layout for the whole model');
  });

  test('a case whose text is not in the example fails', () => {
    expect(() =>
      caseFiles({
        name: '',
        rows: [],
        changes: [
          { file: 'entities/tag.yaml', search: 'no such text', replace: '' },
        ],
        issues: [],
      }),
    ).toThrow('is not in entities/tag.yaml');
    expect(() =>
      caseFiles({
        name: '',
        rows: [],
        changes: [{ file: 'entities/tag.yaml', add: '' }],
        issues: [],
      }),
    ).toThrow('already in the example');
  });
});

const caseNamed = (name: string): RuleCase => {
  const found = RULE_CASES.find((rule) => rule.name === name);
  if (!found) throw new Error(`No case ${name}`);
  return found;
};

const exampleModel = async () => {
  const { model, positions } = await loadModel(exampleFileSystem(), '');
  return { model, positions };
};

/** `model` with the entity of `file` given new `data`, or left out when `data` is omitted. */
function withEntity(model: Model, file: string, data?: unknown): Model {
  return {
    ...model,
    entities: model.entities.flatMap((item) =>
      item.file !== file
        ? [item]
        : data === undefined
          ? []
          : [{ file, data: data as EntityData }],
    ),
  };
}

const ruleError = (
  rule: Issue['rule'],
  file: string,
  path: string,
  message: string,
  position?: { line: number; column: number },
): Issue => ({ rule, severity: 'error', file, path, ...position, message });

describe('규칙 사례: types, models in memory, ordering', () => {
  test('R06 compares types: key order and two missing types are equal, another domain or a type for a domain differ', () => {
    const rulesOf = (name: string) =>
      caseNamed(name).issues.map((issue) => issue.rule);
    expect(
      rulesOf(
        'migrated attribute with the type of its parent in another key order',
      ),
    ).toEqual([]);
    expect(
      rulesOf('migrated attribute and its parent both without domain and type'),
    ).toEqual([]);
    expect(
      rulesOf('migrated attribute with another domain than its parent'),
    ).toEqual(['R06']);
    expect(
      rulesOf('migrated attribute with a type where its parent has a domain'),
    ).toEqual(['R06']);
  });

  test('a model changed in memory gets schema and rule issues with paths and without positions', async () => {
    const { model } = await exampleModel();
    const customer = model.entities.find(
      (item) => item.file === 'entities/customer.yaml',
    );
    if (!customer) throw new Error('no customer');
    const attributes = customer.data.attributes.map((attribute) =>
      attribute.id === 'cust_nm'
        ? { ...attribute, domain: 'namex' }
        : attribute,
    );
    const changed: Model = {
      ...withEntity(model, customer.file, { ...customer.data, attributes }),
      subjectAreas: model.subjectAreas.map((item) =>
        item.file === 'subject-areas/party.yaml'
          ? { ...item, data: { ...item.data, name: 7 as unknown as string } }
          : item,
      ),
    };
    expect(validateModel(changed)).toEqual([
      ruleError(
        'R02',
        'entities/customer.yaml',
        '/attributes/1/domain',
        'attribute "cust_nm": unknown domain "namex"',
      ),
      ruleError(
        'schema',
        'subject-areas/party.yaml',
        '/name',
        '/name must be string',
      ),
    ]);
  });

  test('an entity with attributes: null is a schema issue and is left out of the rules', async () => {
    const { model } = await exampleModel();
    const file = 'entities/customer.yaml';
    const customer = model.entities.find((item) => item.file === file);
    if (!customer) throw new Error('no customer');
    const without = validateModel(withEntity(model, file));
    // Leaving customer out breaks what refers to it, so the rules did run.
    expect(without.map((issue) => issue.message)).toContain(
      '"customer_places_order": unknown parent entity "customer"',
    );
    const nulled = withEntity(model, file, {
      ...customer.data,
      attributes: null,
    });
    expect(validateModel(nulled)).toEqual(
      finishIssues([
        ruleError('schema', file, '/attributes', '/attributes must be array'),
        ...without,
      ]),
    );
  });

  test('an entity whose ext is itself is reported as not JSON data and left out of the rules', async () => {
    const { model } = await exampleModel();
    const file = 'entities/customer.yaml';
    const customer = model.entities.find((item) => item.file === file);
    if (!customer) throw new Error('no customer');
    const data: Record<string, unknown> = { ...customer.data };
    data.ext = data;
    expect(validateModel(withEntity(model, file, data))).toEqual(
      finishIssues([
        ruleError('schema', file, '/ext', '/ext must be a JSON value'),
        ...validateModel(withEntity(model, file)),
      ]),
    );
  });

  test('in one file, issues without a position come before those with one', async () => {
    const { model, positions } = await exampleModel();
    const file = 'entities/customer.yaml';
    const customer = model.entities.find((item) => item.file === file);
    if (!customer) throw new Error('no customer');
    const attributes = [
      ...customer.data.attributes.map((attribute) =>
        attribute.id === 'cust_nm'
          ? { ...attribute, term: 'cust_nmx' }
          : attribute,
      ),
      // Added in memory: its path is not in the file's position index.
      { id: 'extra', name: 'X', domain: 'namex' },
    ];
    const changed = withEntity(model, file, { ...customer.data, attributes });
    expect(validateModel(changed, positions)).toEqual([
      ruleError(
        'R02',
        file,
        '/attributes/4/domain',
        'attribute "extra": unknown domain "namex"',
      ),
      ruleError(
        'R02',
        file,
        '/attributes/1/term',
        'attribute "cust_nm": unknown term "cust_nmx"',
        { line: 16, column: 5 },
      ),
    ]);
  });

  test('in a model below the opened folder, R01 names the other file relative to the model folder', async () => {
    const entityCase = caseNamed('duplicate entity id');
    const wordCase = caseNamed('duplicate word id');
    const changed = caseFiles(
      { ...wordCase, changes: [...entityCase.changes, ...wordCase.changes] },
      exampleFiles(),
    );
    const moved = (file: string) =>
      file.startsWith('dictionary/')
        ? `dict/${file.slice('dictionary/'.length)}`
        : `m/${file}`;
    const files = replaceOnce(
      Object.fromEntries(
        Object.entries(changed).map(([file, text]) => [moved(file), text]),
      ),
      'm/model.yaml',
      'targets:\n',
      'dictionaries:\n  - ../dict\ntargets:\n',
    );
    const { issues } = await check(files, 'm');
    expect(issues).toEqual(
      finishIssues(
        [...entityCase.issues, ...wordCase.issues].map((issue) => ({
          ...issue,
          file: moved(issue.file),
          message: issue.message.replace(
            '(also in dictionary/standard.yaml)',
            '(also in ../dict/standard.yaml)',
          ),
        })),
      ),
    );
    expect(issues.map((issue) => issue.message)).toContain(
      'duplicate entity id "customer" (also in entities/customer.yaml)',
    );
  });

  test('a dir that is not a string counts as the opened folder', async () => {
    const files = caseFiles(caseNamed('duplicate entity id'));
    const { model } = await loadModel(exampleFileSystem(files), '');
    const odd = { ...model, dir: 7 } as unknown as Model;
    expect(validateModel(odd)).toEqual(validateModel(model));
  });
});

/** A small deterministic random source (mulberry32). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `value` behind Proxies that pass for plain data but, at random, throw from
 * a trap or report another value than they hold (so a second look can
 * disagree with the first).
 */
function hostile(value: unknown, next: () => number, rate: number): unknown {
  const wrapped = new WeakMap<object, object>();
  const junk = [null, 1, 'x', {}, [], undefined];
  const wrap = (inner: unknown): unknown => {
    if (typeof inner !== 'object' || inner === null) return inner;
    const known = wrapped.get(inner);
    if (known) return known;
    const trap = () => {
      if (next() < rate) throw new Error('trap');
    };
    const proxy = new Proxy(inner, {
      getOwnPropertyDescriptor(target, key) {
        trap();
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        if (!descriptor || !('value' in descriptor)) return descriptor;
        if (descriptor.configurable && next() < rate) {
          return {
            ...descriptor,
            value: junk[Math.floor(next() * junk.length)],
          };
        }
        return { ...descriptor, value: wrap(descriptor.value) };
      },
      ownKeys(target) {
        trap();
        return Reflect.ownKeys(target);
      },
      get(target, key, receiver) {
        trap();
        return wrap(Reflect.get(target, key, receiver));
      },
      has(target, key) {
        trap();
        return Reflect.has(target, key);
      },
      getPrototypeOf(target) {
        trap();
        return Reflect.getPrototypeOf(target);
      },
    });
    wrapped.set(inner, proxy);
    return proxy;
  };
  return wrap(value);
}

describe('규칙 사례: never throws', () => {
  test('data behind Proxies that throw or change their answers at random', async () => {
    const { model, positions } = await exampleModel();
    const lists = [
      'entities',
      'relationships',
      'subtypes',
      'subjectAreas',
      'layouts',
      'dictionaries',
    ] as const;
    let runs = 0;
    for (const rate of [0.001, 0.01, 0.05]) {
      for (let seed = 1; seed <= 40; seed += 1) {
        const next = random(seed * 1000 + rate * 1000);
        const wrapItem = <T>(item: ModelItem<T>) => ({
          file: item.file,
          data: hostile(item.data, next, rate) as T,
        });
        const changed: Model = {
          ...model,
          ...(model.manifest ? { manifest: wrapItem(model.manifest) } : {}),
        };
        for (const list of lists) {
          (changed[list] as ModelItem<unknown>[]) = (
            model[list] as ModelItem<unknown>[]
          ).map(wrapItem);
        }
        let issues: Issue[] | undefined;
        expect(() => {
          issues = validateModel(changed, positions);
        }).not.toThrow();
        expect(Array.isArray(issues)).toBe(true);
        runs += 1;
      }
    }
    expect(runs).toBe(120);
  });
});

describe('규칙 사례: time', () => {
  const all = (n: number): Sizes => ({ wide: n, many: n, terms: n });

  test('the big models are what the time test expects', () => {
    expect(validateModel(bigModel(all(3)))).toEqual([]);
    expect(validateModel(bigModel(all(2_000)))).toEqual([]);
    expect(validateModel(bigModel(all(3), true))).toHaveLength(
      brokenCount(all(3)),
    );
    expect(validateModel(bigModel(all(2_000), true))).toHaveLength(
      brokenCount(all(2_000)),
    );
  });
});
