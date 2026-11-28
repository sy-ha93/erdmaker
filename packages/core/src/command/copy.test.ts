import { describe, expect, test } from 'vitest';
import {
  ACCEPTED_INPUTS,
  manyKeys,
  nested,
  REJECTED_INPUTS,
} from '../testing/commands.js';
import {
  AWKWARD_STRINGS,
  Random,
  randomJson,
  randomString,
} from '../testing/generate.js';
import { copyCommand } from './copy.js';
import { readCommand } from './check.js';
import { oneLineMessage } from './message.js';

/** The copy's message as `execute` would return it. */
function refusal(input: unknown): string | undefined {
  const copied = copyCommand(input);
  return copied.ok ? undefined : oneLineMessage(copied.message);
}

/** Every object reachable from `value`, walked with a stack. */
function objectsIn(value: unknown): Set<object> {
  const seen = new Set<object>();
  const pending = [value];
  while (pending.length > 0) {
    const next = pending.pop();
    if (typeof next !== 'object' || next === null || seen.has(next)) continue;
    seen.add(next);
    for (const child of Object.values(next)) pending.push(child);
  }
  return seen;
}

const withExt = (ext: unknown): Record<string, unknown> => ({
  type: 'entity.create',
  name: 'a',
  ext,
});

describe('믿을 수 없는 입력: 복사', () => {
  const copyRows = REJECTED_INPUTS.filter(
    (row) => row.step === 'shape' || row.step === 'copy',
  );

  test('the refused table has a row for each kind of failure of steps 1 and 2', () => {
    expect(copyRows.length).toBe(29);
  });

  test.each(copyRows.map((row) => [row.name, row] as const))(
    'refuses %s with its message',
    (_name, row) => {
      try {
        const input = row.input();
        expect(refusal(input)).toBe(row.message);
        // The same message comes out of the whole input layer.
        const read = readCommand(input);
        expect(read.ok).toBe(false);
        if (!read.ok) expect(oneLineMessage(read.message)).toBe(row.message);
      } finally {
        row.cleanup?.();
      }
      // The inherited-index row must leave `Array.prototype` as it found it.
      expect(Object.hasOwn(Array.prototype, 0)).toBe(false);
    },
  );

  test.each(ACCEPTED_INPUTS.map((row) => [row.name, row] as const))(
    'copies %s',
    (_name, row) => {
      const copied = copyCommand(row.input());
      expect(copied).toEqual({ ok: true, value: row.copy() });
    },
  );

  test('a __proto__ key is an own data property and changes no prototype', () => {
    const copied = copyCommand(
      JSON.parse(
        '{"type":"entity.create","name":"a","ext":{"__proto__":{"x":1}}}',
      ),
    );
    if (!copied.ok) throw new Error(copied.message);
    const ext = copied.value.ext as Record<string, unknown>;
    expect(Object.getPrototypeOf(ext)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(ext, '__proto__')).toEqual({
      value: { x: 1 },
      writable: true,
      enumerable: true,
      configurable: true,
    });
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  test('the copy shares no object with the input', () => {
    const input = {
      type: 'entity.create',
      name: 'a',
      physical: { name: 'A' },
      ext: { list: [{ a: 1 }, [2, [3]]], empty: {}, none: Object.create(null) },
    };
    const copied = copyCommand(input);
    if (!copied.ok) throw new Error(copied.message);
    expect(copied.value).toEqual(input);
    const inInput = objectsIn(input);
    for (const object of objectsIn(copied.value)) {
      expect(inInput.has(object)).toBe(false);
    }
    // Every object of the copy is plain: an array or an `Object.prototype` object.
    for (const object of objectsIn(copied.value)) {
      expect([Array.prototype, Object.prototype]).toContain(
        Object.getPrototypeOf(object),
      );
    }
  });

  test('keeps -0, finite numbers and a null prototype object as plain data', () => {
    const copied = copyCommand(
      withExt({ z: -0, big: 1e300, tiny: 5e-324, none: Object.create(null) }),
    );
    if (!copied.ok) throw new Error(copied.message);
    const ext = copied.value.ext as Record<string, unknown>;
    expect(Object.is(ext.z, -0)).toBe(true);
    expect(ext.big).toBe(1e300);
    expect(ext.tiny).toBe(5e-324);
    expect(ext.none).toEqual({});
  });

  test.each([
    ['Infinity', Infinity],
    ['a bigint', 1n],
    ['a symbol', Symbol('s')],
    ['a Map', new Map()],
    ['a boxed string', Object('s')],
  ])('refuses %s', (_name, value) => {
    expect(refusal(withExt({ v: value }))).toBe('/ext/v must be a JSON value');
  });

  test('refuses a command that is not a plain object, and escapes the pointer of a key', () => {
    expect(refusal(new Date(0))).toBe('/ must be a JSON value');
    expect(refusal(Object.create({ type: 'entity.create' }))).toBe(
      '/ must be a JSON value',
    );
    expect(refusal(withExt({ 'a/b~c': () => 1 }))).toBe(
      '/ext/a~1b~0c must be a JSON value',
    );
    expect(refusal(withExt({ '': [0, { x: NaN }] }))).toBe(
      '/ext//1/x must be a JSON value',
    );
  });

  test('refuses a revoked proxy without throwing', () => {
    const command = Proxy.revocable({}, {});
    command.revoke();
    expect(refusal(command.proxy)).toBe('/ must be a JSON value');
    const ext = Proxy.revocable({}, {});
    ext.revoke();
    expect(refusal(withExt(ext.proxy))).toBe('/ext must be a JSON value');
  });

  test('refuses an array proxy whose length is not a length', () => {
    const lying = new Proxy([1], {
      get: (target, key) => (key === 'length' ? -1 : Reflect.get(target, key)),
    });
    expect(refusal(withExt({ a: lying }))).toBe('/ext/a must be a JSON value');
  });

  test('reads each property once and an array length once, getters included', () => {
    const reads = new Map<PropertyKey, number>();
    const count = (key: PropertyKey): void => {
      reads.set(key, (reads.get(key) ?? 0) + 1);
    };
    const list = new Proxy(['x', 'y'], {
      get(target, key, receiver) {
        count(`list.${String(key)}`);
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    const command = {
      type: 'entity.create',
      get name() {
        count('name');
        return 'a';
      },
      ext: { list },
    };
    expect(copyCommand(command)).toEqual({
      ok: true,
      value: { type: 'entity.create', name: 'a', ext: { list: ['x', 'y'] } },
    });
    expect(reads.get('name')).toBe(1);
    expect(reads.get('list.length')).toBe(1);
    // Indexes are read through their descriptors, not `get`.
    expect(reads.has('list.0')).toBe(false);
  });

  test('stops at the first failure and reads nothing after it', () => {
    let read = false;
    const command = {
      type: 'entity.create',
      name: 'a',
      ext: { bad: NaN },
      get later() {
        read = true;
        return 1;
      },
    };
    expect(refusal(command)).toBe('/ext/bad must be a JSON value');
    expect(read).toBe(false);
  });

  test('limits are reported depth, then values, then text, within one visit', () => {
    // The 100001st value is also the one past 1000000 characters: values.
    expect(
      refusal(
        withExt({
          ...manyKeys(100_001 - 3 - 1, 0),
          long: 'x'.repeat(1_000_000),
        }),
      ),
    ).toBe('command has more than 100000 values');
    // The key that reaches level 33 also passes 1000000 characters: depth.
    expect(refusal(withExt(nested(32, 'x'.repeat(1_000_000))))).toBe(
      'command is nested more than 32 levels deep',
    );
    // A key's length counts as text, whatever its value.
    expect(refusal(withExt({ ['k'.repeat(1_000_000)]: undefined }))).toBe(
      'command has more than 1000000 characters of text',
    );
    // A failing value at the place a limit is passed: the limit.
    expect(refusal(withExt({ ['k'.repeat(1_000_000)]: NaN }))).toBe(
      'command has more than 1000000 characters of text',
    );
    expect(
      refusal(withExt({ ...manyKeys(100_001 - 3 - 1, 0), d: new Date(0) })),
    ).toBe('command has more than 100000 values');
  });

  test('counts an array item and a key as one value each', () => {
    // type, name, ext, list, then 99996 items: 100000.
    expect(copyCommand(withExt({ list: new Array(99_996).fill(0) })).ok).toBe(
      true,
    );
    expect(refusal(withExt({ list: new Array(99_997).fill(0) }))).toBe(
      'command has more than 100000 values',
    );
  });

  test('a very deep or very long input is refused without growing the call stack', () => {
    expect(refusal(withExt(nested(200_000)))).toBe(
      'command is nested more than 32 levels deep',
    );
    expect(refusal(withExt({ list: new Array(10_000_000) }))).toBe(
      '/ext/list/0 must be a JSON value',
    );
  });

  test('never throws, for awkward strings and random JSON', () => {
    const random = new Random(7);
    for (const text of AWKWARD_STRINGS) {
      expect(copyCommand(withExt({ [text]: text })).ok).toBe(true);
    }
    for (let i = 0; i < 300; i += 1) {
      const value = randomJson(random, 6);
      const input = withExt({ [randomString(random)]: value });
      expect(copyCommand(input)).toEqual({ ok: true, value: input });
    }
  });
});
