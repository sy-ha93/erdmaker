import { describe, expect, test } from 'vitest';
import { parse, stringify } from 'yaml';
import { createMemoryFileSystem } from '../fs/memory.js';
import { createNodeFileSystem } from '../node/fs.js';
import { parseYaml } from '../parse/yaml.js';
import { Random, randomModel } from '../testing/generate.js';
import {
  EXAMPLE_DIR,
  exampleFiles,
  type Files,
  replaceOnce,
} from '../testing/example.js';
import { validateModel } from '../validate/index.js';
import { loadModel } from './load.js';
import { serializeModel } from './serialize.js';
import type { Model } from './types.js';

const asFiles = (model: Model): Files =>
  Object.fromEntries(
    serializeModel(model).map(({ file, text }) => [file, text]),
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Maps without `properties` in the schemas: their key order is data, not form. */
const ORDERED_MAPS = new Set(['ext', 'physicalTypes', 'types']);

/** A copy with the keys of every schema-shaped object reversed (all but `ORDERED_MAPS` and what they hold). */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, item]) => [
        key,
        ORDERED_MAPS.has(key) ? item : reverseKeys(item),
      ]),
  );
}

/** Every default of the schemas written out where the data leaves it out. */
function withDefaults(
  file: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const fill = (object: unknown, defaults: Record<string, unknown>) => {
    if (!isRecord(object)) return;
    for (const [key, value] of Object.entries(defaults)) {
      if (!(key in object)) object[key] = value;
    }
  };
  const each = (list: unknown, defaults: Record<string, unknown>) => {
    if (Array.isArray(list)) for (const item of list) fill(item, defaults);
  };
  const copy = structuredClone(data);
  if (file === 'model.yaml') {
    fill(copy, { notation: 'ie', dictionaries: ['dictionary'] });
    each(copy.schemas, { role: 'main' });
  } else if (file.startsWith('entities/')) {
    fill(copy, { scope: 'both' });
    each(copy.attributes, { nullable: true });
    // `rolenamed` may only stand beside `migratedFrom` (dependentRequired).
    if (Array.isArray(copy.attributes)) {
      for (const attribute of copy.attributes) {
        if (isRecord(attribute) && 'migratedFrom' in attribute) {
          fill(attribute, { rolenamed: false });
        }
      }
    }
    each(copy.keys, { scope: 'both' });
  } else if (file.startsWith('relationships/')) {
    fill(copy, { scope: 'both' });
    // A many-to-many relationship has no cardinality.
    // A many-to-many relationship has no cardinality. An empty one stays as it is:
    // filled with defaults it would be an object that only defaults left empty.
    if (copy.kind !== 'many-to-many') {
      if (!('cardinality' in copy)) {
        copy.cardinality = { parent: 'one', child: 'zero-or-more' };
      } else if (Object.keys(copy.cardinality as object).length > 0) {
        fill(copy.cardinality, { parent: 'one', child: 'zero-or-more' });
      }
    }
  } else if (file.startsWith('subtypes/')) {
    fill(copy, {
      completeness: 'incomplete',
      exclusivity: 'exclusive',
      scope: 'both',
    });
  } else if (file.startsWith('dictionary/')) {
    each(copy.words, { classifier: false });
  }
  return copy;
}

const crlf = (text: string) => text.replaceAll('\n', '\r\n');

/** AC-02: the example out of canonical form in every way the reader accepts. */
function perturbed(files: Files): Files {
  const out: Files = {};
  for (const [file, text] of Object.entries(files)) {
    if (file.endsWith('.json')) {
      out[file] = crlf(JSON.stringify(reverseKeys(JSON.parse(text)), null, 4));
      continue;
    }
    const data = withDefaults(
      file,
      parse(text, { version: '1.2', schema: 'core' }),
    );
    if (file.startsWith('subject-areas/')) {
      (data.entities as string[]).reverse();
    }
    out[file] = crlf(
      stringify(reverseKeys(data), { version: '1.2', schema: 'core' }),
    );
  }
  return out;
}

async function loadFiles(files: Files) {
  const loaded = await loadModel(createMemoryFileSystem(files), '');
  return {
    ...loaded,
    issues: [
      ...loaded.issues,
      ...validateModel(loaded.model, loaded.positions),
    ],
  };
}

describe('예제 왕복', () => {
  test('the example read from disk serializes to its own files, byte for byte', async () => {
    const loaded = await loadModel(createNodeFileSystem(EXAMPLE_DIR), '');
    expect([
      ...loaded.issues,
      ...validateModel(loaded.model, loaded.positions),
    ]).toEqual([]);
    const disk = exampleFiles();
    expect(Object.keys(disk)).toHaveLength(29);
    const written = serializeModel(loaded.model);
    expect(written.map(({ file }) => file)).toEqual(Object.keys(disk));
    for (const { file, text } of written)
      expect([file, text]).toEqual([file, disk[file]]);
  });

  test('pinned: each YAML file is what `stringify` gives for the data with the spec options', async () => {
    const { model } = await loadModel(createNodeFileSystem(EXAMPLE_DIR), '');
    const options = {
      version: '1.2',
      schema: 'core',
      lineWidth: 0,
      compat: 'yaml-1.1',
      aliasDuplicateObjects: false,
    } as const;
    const items = [
      model.manifest!,
      ...model.dictionaries,
      ...model.entities,
      ...model.relationships,
      ...model.subtypes,
      ...model.subjectAreas,
    ];
    expect(items).toHaveLength(27);
    const written = asFiles(model);
    for (const { file, data } of items) {
      expect(written[file]).toBe(stringify(data, options));
    }
    // Without `compat`, `"NO"` loses its quotes (spec chapter 2).
    expect(written['dictionary/standard.yaml']).toContain('abbreviation: "NO"');
  });
});

describe('비정규형 입력', () => {
  test('key order, defaults, entities order, CRLF and 4-space JSON do not change the bytes', async () => {
    const original = exampleFiles();
    const files = perturbed(original);
    // Every file really is out of form.
    for (const [file, text] of Object.entries(files)) {
      expect(text, file).not.toBe(original[file]);
      expect(text).toContain('\r\n');
    }
    expect(files['model.yaml']).toMatch(
      /^dictionaries:\r\n {2}- dictionary\r\nnotation: ie\r\n/m,
    );
    expect(files['layouts/sales.json']).toMatch(/^ {4}"edges": \{\r\n/m);
    const loaded = await loadFiles(files);
    expect(loaded.issues).toEqual([]);
    expect(asFiles(loaded.model)).toEqual(original);
  });

  test('physicalTypes and physical.types keep their order, reversed or not', async () => {
    let files = replaceOnce(
      exampleFiles(),
      'dictionary/standard.yaml',
      '    physicalTypes:\n      postgresql: bigint\n      mysql: bigint\n',
      '    physicalTypes:\n      mysql: bigint\n      postgresql: bigint\n',
    );
    files = replaceOnce(
      files,
      'entities/product.yaml',
      '      types:\n        postgresql: jsonb\n',
      '      types:\n        sqlite: text\n        postgresql: jsonb\n',
    );
    const loaded = await loadFiles(files);
    expect(loaded.issues).toEqual([]);
    expect(asFiles(loaded.model)).toEqual(files);
  });
});

/** Order-sensitive deep equality of JSON data; numbers by `Object.is`, so `-0` is not `0`. */
function sameData(a: unknown, b: unknown): boolean {
  if (
    typeof a !== 'object' ||
    a === null ||
    typeof b !== 'object' ||
    b === null
  ) {
    return Object.is(a, b);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  const other = Object.keys(b);
  return (
    keys.length === other.length &&
    keys.every(
      (key, index) =>
        other[index] === key &&
        sameData(
          Object.getOwnPropertyDescriptor(a, key)?.value,
          Object.getOwnPropertyDescriptor(b, key)?.value,
        ),
    )
  );
}

/** A copy whose schema-shaped objects have their keys in a random order, with `put` for `__proto__`. */
function shuffleKeys(random: Random, value: unknown): unknown {
  if (Array.isArray(value))
    return value.map((item) => shuffleKeys(random, item));
  if (!isRecord(value)) return value;
  const entries = Object.entries(value);
  for (let i = entries.length - 1; i > 0; i -= 1) {
    const j = random.int(0, i);
    [entries[i], entries[j]] = [entries[j]!, entries[i]!];
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of entries) {
    Object.defineProperty(out, key, {
      value: ORDERED_MAPS.has(key) ? item : shuffleKeys(random, item),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

const MODELS = 500;

describe('왕복 성질', () => {
  test(`${MODELS} random models: read back equal with no issues, written again the same`, async () => {
    let files = 0;
    // What the generated models made the writer do, to show the property covers it.
    const seen = new Set<string>();
    const FEATURES: [string, RegExp][] = [
      ['keep block scalar', /: \|\+\n/],
      ['strip block scalar', /: \|-\n/],
      ['indented block scalar', /: \|\d/],
      ['double-quoted last value', /\\n"\n$/],
      ['long double-quoted last value', /: ".{40,}\\n"\n$/],
      ['escaped control character', /\\x[0-9a-f]{2}|\\[0abtvfre]/],
      ['escaped lone surrogate', /\\ud[89a-f]/],
      ['explicit long key', /^ *\? /m],
      ['quoted 1.1 keyword', /: "(?:y|n|yes|no|on|off|NO|Yes)"$/m],
      ['quoted number-like', /: "(?:0\.1|1e3|0x1F|1:30|2001-12-14|017)"$/m],
      ['line over 1000 characters', /^.{1000}/m],
      ['-0', /(?:: |- |"x": )-0\b/],
      ['exponent', /\de-\d/],
      ['__proto__ key', /__proto__/],
      ['all-digit node id', /^ {4}"\d+": \{ "x"/m],
      ['empty map', /: \{\}$/m],
      ['empty list', /: \[\]$/m],
      ['unicode', /[가-힣]/],
      ['emoji', /\p{Extended_Pictographic}/u],
    ];
    for (let seed = 1; seed <= MODELS; seed += 1) {
      const model = randomModel(new Random(seed));
      const written = serializeModel(model);
      files += written.length;
      for (const { file, text } of written) {
        for (const [name, pattern] of FEATURES) {
          if (pattern.test(text)) seen.add(name);
        }
        const where = `seed ${seed}, ${file}`;
        // One line end at the end, LF only.
        expect(text, where).toMatch(/(?:^|[^\n])\n$/);
        expect(text, where).not.toContain('\r');
        if (file.endsWith('.yaml')) {
          // No anchor, alias, tag or comment, nor any other issue.
          const parsed = parseYaml(file, text);
          expect([parsed.issues, parsed.firstComment], where).toEqual([
            [],
            undefined,
          ]);
        }
      }
      const loaded = await loadModel(
        createMemoryFileSystem(asFiles(model)),
        '',
      );
      expect(loaded.issues, `seed ${seed}`).toEqual([]);
      expect(loaded.model, `seed ${seed}`).toEqual(model);
      expect(sameData(loaded.model, model), `seed ${seed}`).toBe(true);
      expect(serializeModel(loaded.model), `seed ${seed}`).toEqual(written);
    }
    expect(files).toBeGreaterThan(MODELS * 5);
    expect([...seen].sort()).toEqual(FEATURES.map(([name]) => name).sort());
  }, 120_000);

  test(`${MODELS} random models: schema keys in any order, defaults written out, the same bytes`, () => {
    for (let seed = 1; seed <= MODELS; seed += 1) {
      const model = randomModel(new Random(seed));
      const random = new Random(-seed);
      const shuffle = <T extends { file: string; data: unknown }>(
        item: T,
      ): T => ({
        ...item,
        data: shuffleKeys(
          random,
          withDefaults(item.file, item.data as Record<string, unknown>),
        ),
      });
      const perturbed: Model = {
        ...model,
        manifest: shuffle(model.manifest!),
        entities: model.entities.map(shuffle),
        relationships: model.relationships.map(shuffle),
        subtypes: model.subtypes.map(shuffle),
        subjectAreas: model.subjectAreas.map((item) => {
          const out = shuffle(item);
          out.data.entities = [...out.data.entities].reverse();
          return out;
        }),
        layouts: model.layouts.map(shuffle),
        dictionaries: model.dictionaries.map(shuffle),
      };
      expect(serializeModel(perturbed), `seed ${seed}`).toEqual(
        serializeModel(model),
      );
    }
  }, 120_000);
});
