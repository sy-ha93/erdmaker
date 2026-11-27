import type { Model } from '../model/types.js';

/** A seeded random source (mulberry32), so a failing model can be made again from its seed. */
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** In [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(list: readonly T[]): T {
    return list[this.int(0, list.length - 1)]!;
  }
}

/** Strings a writer is likely to get wrong. */
export const AWKWARD_STRINGS: readonly string[] = [
  '',
  ' ',
  '  lead',
  'trail  ',
  ' both ',
  '\t',
  '\ttab',
  'tab\t',
  'a\tb',
  '#',
  '# not a comment',
  'a #b',
  'a#b',
  ':',
  'a: b',
  'a:',
  ':a',
  '-',
  '- a',
  '-a',
  '--',
  '---',
  '...',
  '--- a',
  '?',
  '? a',
  '"',
  "'",
  '"quoted"',
  "'quoted'",
  'it\'s "both"',
  '\\',
  'back\\slash',
  '\\n',
  '\\"',
  '!',
  '!tag',
  '!!str',
  '&anchor',
  '*alias',
  '%YAML 1.1',
  '@',
  '`',
  '|',
  '>',
  '{',
  '}',
  '[',
  ']',
  ',',
  '{a: 1}',
  '[1, 2]',
  '<<',
  '=',
  // YAML 1.1 and 1.2 keywords.
  'y',
  'Y',
  'n',
  'N',
  'yes',
  'Yes',
  'YES',
  'no',
  'No',
  'NO',
  'on',
  'On',
  'ON',
  'off',
  'Off',
  'OFF',
  'true',
  'True',
  'TRUE',
  'false',
  'False',
  'FALSE',
  'null',
  'Null',
  'NULL',
  '~',
  '.inf',
  '-.inf',
  '+.inf',
  '.Inf',
  '.INF',
  '.nan',
  '.NaN',
  '.NAN',
  // Number-like and date-like.
  '0',
  '-0',
  '+0',
  '00',
  '017',
  '0o17',
  '0x1F',
  '0b101',
  '1_000',
  '1,000',
  '0.1',
  '.5',
  '1.',
  '1e3',
  '1E3',
  '-1.5e-7',
  '9007199254740993',
  '1:30',
  '1:30:00',
  '190:20:30',
  '2001-12-14',
  '2001-12-14t21:59:43.10-05:00',
  '2001-12-14 21:59:43.10 -5',
  '12:30',
  // Unicode, emoji and control characters.
  '한글',
  '고객번호',
  'é',
  'é',
  '日本語',
  '😀',
  '👨‍👩‍👧',
  'a😀b',
  ' ',
  'nbsp end',
  '﻿',
  '﻿bom',
  ' ',
  'line sep',
  ' ',
  '\u0085',
  'next\u0085line',
  '\u0000',
  'nul\u0000byte',
  '\u0007',
  '\u0008',
  '\u000b',
  '\u000c',
  '\u001b',
  '\u007f',
  '\u0080',
  '\u009f',
  '\r',
  'cr\rcr',
  '\r\n',
  'a\r\nb',
  // Blank lines only: no line sets a block scalar's indentation.
  '\n',
  '\n\n',
  ' \n',
  ' \n\n\n',
  '\t\n',
  '\n \n',
  '  \n\t\n ',
  '\ud800',
  'lone\udc00',
];

/** A string from the awkward list, random characters, a long run or several lines. */
export function randomString(random: Random): string {
  switch (random.int(0, 9)) {
    case 0:
    case 1:
    case 2:
      return random.pick(AWKWARD_STRINGS);
    case 3: {
      const parts: string[] = [];
      for (let i = random.int(1, 4); i > 0; i -= 1) {
        parts.push(random.pick(AWKWARD_STRINGS));
      }
      return parts.join(random.pick(['', ' ', '\n', ': ', ' #']));
    }
    case 4: {
      const lines: string[] = [];
      for (let i = random.int(1, 4); i > 0; i -= 1) {
        lines.push(
          random.chance(0.3) ? random.pick(AWKWARD_STRINGS) : word(random),
        );
      }
      // Every count of trailing newlines, and leading ones.
      return (
        '\n'.repeat(random.chance(0.2) ? random.int(1, 2) : 0) +
        lines.join('\n') +
        '\n'.repeat(random.int(0, 4))
      );
    }
    case 5:
      return random
        .pick(['x', 'ab ', '가', '😀', '\\ '])
        .repeat(random.int(100, 3000));
    case 6: {
      let text = '';
      for (let i = random.int(1, 12); i > 0; i -= 1) {
        text += String.fromCodePoint(
          random.pick([
            random.int(0x20, 0x7e),
            random.int(0, 0x1f),
            random.int(0x7f, 0xff),
            random.int(0x100, 0xd7ff),
            random.int(0xe000, 0xfffd),
            random.int(0x10000, 0x10ffff),
          ]),
        );
      }
      return text;
    }
    default:
      return word(random);
  }
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

function word(random: Random): string {
  let text = '';
  for (let i = random.int(1, 8); i > 0; i -= 1)
    text += random.pick([...LETTERS]);
  return text;
}

/** A non-empty string (`minLength: 1`). */
function text(random: Random): string {
  const value = randomString(random);
  return value === '' ? 'x' : value;
}

const ID_FIRST = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ID_REST = `${ID_FIRST}_-`;

/** An id the schema accepts, all-digit ones included. */
export function randomId(random: Random): string {
  if (random.chance(0.15)) return String(random.int(0, 120));
  let id = random.pick([...ID_FIRST]);
  for (let i = random.int(0, 10); i > 0; i -= 1)
    id += random.pick([...ID_REST]);
  return id;
}

/** A number JSON data may hold: -0, safe integers up to the limits, floats with exponents. */
export function randomNumber(random: Random): number {
  switch (random.int(0, 6)) {
    case 0:
      return random.pick([
        0,
        -0,
        1,
        -1,
        Number.MAX_SAFE_INTEGER,
        -Number.MAX_SAFE_INTEGER,
      ]);
    case 1:
      return random.int(-1e6, 1e6);
    case 2:
      return Math.trunc((random.next() * 2 - 1) * Number.MAX_SAFE_INTEGER);
    default: {
      const value =
        (random.next() + 0.1) *
        10 ** random.int(-320, 15) *
        (random.chance(0.5) ? -1 : 1);
      return Number.isInteger(value) && !Number.isSafeInteger(value)
        ? 0.25
        : value;
    }
  }
}

function integer(random: Random, min = -1e6): number {
  const value = random.int(min, 1e6);
  return random.chance(0.05) && min <= 0 ? -0 : value;
}

/** Sets a key as an own property, `__proto__` included. */
function put(
  object: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(object, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** Any JSON data, up to `depth` collections deep: the contents of `ext`. */
export function randomJson(random: Random, depth: number): unknown {
  const kind = random.int(0, depth > 0 ? 8 : 4);
  switch (kind) {
    case 0:
      return null;
    case 1:
      return random.chance(0.5);
    case 2:
      return randomNumber(random);
    case 3:
    case 4:
      return randomString(random);
    case 5:
    case 6: {
      const list: unknown[] = [];
      for (let i = random.int(0, 4); i > 0; i -= 1)
        list.push(randomJson(random, depth - 1));
      return list;
    }
    default: {
      const object: Record<string, unknown> = {};
      for (let i = random.int(0, 4); i > 0; i -= 1) {
        const key = random.chance(0.1) ? '__proto__' : randomString(random);
        put(object, key, randomJson(random, depth - 1));
      }
      return object;
    }
  }
}

/** Optional keys: each `[key, make]` is set with probability `p`, in the given order. */
function some(
  random: Random,
  object: Record<string, unknown>,
  keys: [string, () => unknown][],
  p = 0.5,
): Record<string, unknown> {
  for (const [key, make] of keys)
    if (random.chance(p)) put(object, key, make());
  return object;
}

function list<T>(random: Random, min: number, max: number, make: () => T): T[] {
  const out: T[] = [];
  for (let i = random.int(min, max); i > 0; i -= 1) out.push(make());
  return out;
}

function unique(
  random: Random,
  min: number,
  max: number,
  make: () => string,
): string[] {
  return [...new Set(list(random, min, max, make))];
}

/** An `ext` object holding any JSON data. */
/** Distinct ids in code unit order. */
const sortedIds = (random: Random, min: number, max: number) =>
  unique(random, min, max, () => randomId(random)).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

const ext = (random: Random) => {
  const object: Record<string, unknown> = {};
  for (let i = random.int(0, 4); i > 0; i -= 1) {
    put(
      object,
      random.chance(0.1) ? '__proto__' : randomString(random),
      randomJson(random, 4),
    );
  }
  // `ext` is the last key of every file: often enough, end it in a long text of blank lines.
  if (random.chance(0.15)) {
    put(
      object,
      'last',
      `${randomString(random)}${'x'.repeat(random.int(1, 80))}${'\n'.repeat(random.int(1, 4))}`,
    );
  }
  return object;
};
const scalarValue = (random: Random) =>
  random.pick<() => unknown>([
    () => randomString(random),
    () => randomNumber(random),
    () => random.chance(0.5),
  ])();
const dataType = (random: Random) =>
  some(
    random,
    { base: random.pick(['string', 'integer', 'decimal', 'json', 'uuid']) },
    [
      ['length', () => random.int(1, 4000)],
      ['precision', () => random.int(1, 38)],
      ['scale', () => random.int(0, 10)],
    ],
  );
const dbms = (random: Random) =>
  random.pick(['postgresql', 'mysql', 'sqlite', 'db2x']);
const physicalTypes = (random: Random) => {
  const types: Record<string, unknown> = {};
  for (let i = random.int(1, 3); i > 0; i -= 1)
    put(types, dbms(random), text(random));
  return types;
};
const validValues = (random: Random) =>
  list(random, 1, 3, () =>
    some(random, { value: scalarValue(random) }, [
      ['meaning', () => randomString(random)],
    ]),
  );
const defaultValue = (random: Random) =>
  random.chance(0.3) ? { expression: text(random) } : scalarValue(random);
const scope = (random: Random) => random.pick(['logical', 'physical']);

/**
 * A model that the schemas accept (cross-file rules aside), already in the
 * form the writer gives it: keys in schema order, no value equal to its
 * default, sorted subject area entities, items in reading order. Strings,
 * numbers and `ext` data are random.
 */
export function randomModel(random: Random): Model {
  const manifest = some(
    random,
    { formatVersion: '0.1', id: randomId(random), name: text(random) },
    [
      ['definition', () => randomString(random)],
      ['notation', () => 'idef1x'],
      [
        'targets',
        () =>
          list(random, 1, 2, () =>
            some(random, { dbms: dbms(random) }, [
              ['version', () => randomString(random)],
            ]),
          ),
      ],
      [
        'schemas',
        () =>
          list(random, 1, 2, () =>
            some(random, { name: text(random) }, [
              ['role', () => 'linked'],
              ['definition', () => randomString(random)],
            ]),
          ),
      ],
      [
        'areaGroups',
        () =>
          list(random, 0, 2, () =>
            some(random, { id: randomId(random), name: text(random) }, [
              ['definition', () => randomString(random)],
            ]),
          ),
      ],
      ['ext', () => ext(random)],
    ],
  );

  const attribute = () => {
    const out = some(random, { id: randomId(random), name: text(random) }, [
      ['definition', () => randomString(random)],
      ['note', () => randomString(random)],
      ['scope', () => random.pick(['both', 'logical', 'physical'])],
      ['term', () => randomId(random)],
    ]);
    // A domain or a type, never both (the schema's `not`), or neither.
    const typing = random.int(0, 3);
    if (typing < 2) put(out, 'domain', randomId(random));
    else if (typing === 2) put(out, 'type', dataType(random));
    some(random, out, [
      ['nullable', () => false],
      ['default', () => defaultValue(random)],
      ['validValues', () => validValues(random)],
      [
        'physical',
        () =>
          some(random, {}, [
            ['name', () => text(random)],
            ['types', () => physicalTypes(random)],
          ]),
      ],
    ]);
    const migrated = random.chance(0.4);
    if (migrated) {
      put(
        out,
        'migratedFrom',
        list(random, 1, 2, () => ({
          relationship: randomId(random),
          attribute: randomId(random),
        })),
      );
      if (random.chance(0.5)) put(out, 'rolenamed', true);
    }
    return some(random, out, [
      [
        'nameSource',
        () => random.pick(['manual', 'comment', 'dictionary', 'inferred']),
      ],
      ['ext', () => ext(random)],
    ]);
  };

  const entity = () =>
    some(random, { id: randomId(random), name: text(random) }, [
      ['definition', () => randomString(random)],
      ['note', () => randomString(random)],
      ['scope', () => scope(random)],
      ['nameSource', () => random.pick(['manual', 'inferred'])],
      [
        'physical',
        () =>
          some(random, {}, [
            ['name', () => text(random)],
            ['schema', () => randomString(random)],
          ]),
      ],
    ]);

  const entities = list(random, 0, 3, () => {
    const out = entity();
    put(out, 'attributes', list(random, 0, 4, attribute));
    return some(random, out, [
      [
        'keys',
        () =>
          list(random, 0, 2, () =>
            some(
              random,
              {
                id: randomId(random),
                kind: random.pick(['primary', 'alternate', 'inversion']),
              },
              [['name', () => randomString(random)]],
            ),
          ).map((key) => {
            put(
              key,
              'attributes',
              unique(random, 1, 3, () => randomId(random)),
            );
            return some(random, key, [
              ['scope', () => scope(random)],
              [
                'physical',
                () => some(random, {}, [['name', () => text(random)]]),
              ],
              ['ext', () => ext(random)],
            ]);
          }),
      ],
      ['ext', () => ext(random)],
    ]);
  });

  const relationships = list(random, 0, 2, () => {
    const kind = random.pick([
      'identifying',
      'non-identifying',
      'many-to-many',
    ]);
    const out = some(
      random,
      {
        id: randomId(random),
        kind,
        parent: randomId(random),
        child: randomId(random),
      },
      [
        ['name', () => randomString(random)],
        ['definition', () => randomString(random)],
        [
          'verbPhrase',
          () =>
            some(random, {}, [
              ['parentToChild', () => randomString(random)],
              ['childToParent', () => randomString(random)],
            ]),
        ],
      ],
    );
    if (kind !== 'many-to-many') {
      if (random.chance(0.5)) {
        const cardinality: Record<string, unknown> = {};
        if (kind !== 'identifying' && random.chance(0.5))
          put(cardinality, 'parent', 'zero-or-one');
        const child = random.pick([
          'zero-or-more',
          'one-or-more',
          'zero-or-one',
          'exactly',
        ]);
        if (child !== 'zero-or-more') put(cardinality, 'child', child);
        if (child === 'exactly') put(cardinality, 'count', random.int(1, 9));
        put(out, 'cardinality', cardinality);
      }
      some(random, out, [
        ['parentKey', () => randomId(random)],
        [
          'referentialIntegrity',
          () =>
            some(
              random,
              {},
              [
                'parentInsert',
                'parentUpdate',
                'parentDelete',
                'childInsert',
                'childUpdate',
                'childDelete',
              ].map((key): [string, () => unknown] => [
                key,
                () =>
                  random.pick([
                    'cascade',
                    'restrict',
                    'set-null',
                    'set-default',
                    'none',
                  ]),
              ]),
            ),
        ],
      ]);
    } else if (random.chance(0.5)) {
      put(out, 'resolvedBy', randomId(random));
    }
    some(random, out, [['scope', () => scope(random)]]);
    if (kind !== 'many-to-many') {
      some(random, out, [
        ['physical', () => some(random, {}, [['name', () => text(random)]])],
      ]);
    }
    return some(random, out, [['ext', () => ext(random)]]);
  });

  const subtypes = list(random, 0, 1, () =>
    some(random, { id: randomId(random), supertype: randomId(random) }, [
      ['discriminator', () => randomId(random)],
      ['completeness', () => 'complete'],
      ['exclusivity', () => 'inclusive'],
    ]),
  ).map((out) => {
    put(
      out,
      'members',
      list(random, 1, 3, () =>
        some(random, { id: randomId(random), entity: randomId(random) }, [
          ['discriminatorValue', () => scalarValue(random)],
        ]),
      ),
    );
    return some(random, out, [
      ['definition', () => randomString(random)],
      ['scope', () => scope(random)],
      ['ext', () => ext(random)],
    ]);
  });

  const subjectAreas = list(random, 0, 2, () => {
    const out = some(random, { id: randomId(random), name: text(random) }, [
      ['definition', () => randomString(random)],
      ['group', () => randomId(random)],
      ['order', () => random.int(0, 1e6)],
    ]);
    put(out, 'entities', sortedIds(random, 0, 5));
    return some(random, out, [['ext', () => ext(random)]]);
  });

  const point = () => ({ x: integer(random), y: integer(random) });
  const side = () => random.pick(['top', 'right', 'bottom', 'left']);
  const layouts = list(random, 0, 2, () => {
    const out = some(random, { formatVersion: '0.1' }, [
      ['subjectArea', () => randomId(random)],
      [
        'display',
        () =>
          some(random, {}, [
            ['level', () => random.pick(['entity', 'key', 'attribute'])],
            ['names', () => random.pick(['logical', 'physical', 'both'])],
          ]),
      ],
    ]);
    // In the order the writer gives: ids sorted by code unit.
    const nodes: Record<string, unknown> = {};
    for (const id of sortedIds(random, 0, 5)) {
      put(
        nodes,
        id,
        some(random, point(), [
          ['width', () => integer(random, 1)],
          ['height', () => integer(random, 1)],
          [
            'color',
            () => `#${random.int(0, 0xffffff).toString(16).padStart(6, '0')}`,
          ],
        ]),
      );
    }
    put(out, 'nodes', nodes);
    if (random.chance(0.6)) {
      const edges: Record<string, unknown> = {};
      for (const id of sortedIds(random, 0, 3)) {
        put(
          edges,
          id,
          some(random, {}, [
            ['parentSide', side],
            ['childSide', side],
            ['waypoints', () => list(random, 0, 3, point)],
          ]),
        );
      }
      put(out, 'edges', edges);
    }
    return some(random, out, [['ext', () => ext(random)]]);
  });

  const dictionaries = list(random, 0, 2, () =>
    some(random, {}, [
      [
        'words',
        () =>
          list(random, 0, 3, () =>
            some(random, { id: randomId(random), name: text(random) }, [
              ['englishName', () => randomString(random)],
              ['abbreviation', () => randomString(random)],
              ['definition', () => randomString(random)],
              ['classifier', () => true],
              ['synonyms', () => unique(random, 0, 3, () => text(random))],
              [
                'forbiddenWords',
                () => unique(random, 0, 2, () => text(random)),
              ],
              ['ext', () => ext(random)],
            ]),
          ),
      ],
      [
        'terms',
        () =>
          list(random, 0, 3, () =>
            some(random, { id: randomId(random), name: text(random) }, [
              ['words', () => list(random, 1, 3, () => randomId(random))],
              ['physicalName', () => randomString(random)],
              ['domain', () => randomId(random)],
              ['definition', () => randomString(random)],
              ['synonyms', () => unique(random, 0, 2, () => text(random))],
              ['ext', () => ext(random)],
            ]),
          ),
      ],
      [
        'domains',
        () =>
          list(random, 0, 3, () =>
            some(random, { id: randomId(random), name: text(random) }, [
              ['category', () => randomString(random)],
            ]),
          ).map((domain) => {
            put(domain, 'type', dataType(random));
            return some(random, domain, [
              ['physicalTypes', () => physicalTypes(random)],
              ['validValues', () => validValues(random)],
              ['default', () => defaultValue(random)],
              ['definition', () => randomString(random)],
              ['ext', () => ext(random)],
            ]);
          }),
      ],
      ['ext', () => ext(random)],
    ]),
  );

  const items = <T>(folder: string, extension: string, data: unknown[]) =>
    data.map((value, index) => ({
      file: `${folder}/f${index}.${extension}`,
      data: value as T,
    }));
  return {
    dir: '',
    manifest: { file: 'model.yaml', data: manifest as never },
    entities: items('entities', 'yaml', entities),
    relationships: items('relationships', 'yaml', relationships),
    subtypes: items('subtypes', 'yaml', subtypes),
    subjectAreas: items('subject-areas', 'yaml', subjectAreas),
    layouts: items('layouts', 'json', layouts),
    dictionaries: items('dictionary', 'yaml', dictionaries),
  };
}
