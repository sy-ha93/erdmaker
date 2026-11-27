import { expect } from 'vitest';

/**
 * A time test that tells linear code from quadratic: four times the size
 * takes about four times as long if the code is linear, sixteen times if it
 * is quadratic. Lives in a `*.perf.test.ts` file, which Vitest runs one file
 * at a time after every other test file (see `vitest.config.ts`), so the
 * measurements do not compete with other tests for the processor.
 */
export interface LinearTime<Input, Result> {
  /** The small size and the large one, four times as big. */
  readonly sizes: readonly [small: number, large: number];
  /** Builds the input of a size; not timed. */
  readonly input: (size: number) => Input | Promise<Input>;
  /** The code that is timed. */
  readonly run: (input: Input) => Result | Promise<Result>;
  /** Checks the result of every run, the warm-up included; not timed. */
  readonly check?: (result: Result, size: number) => void;
  /** The large size's best time over the small size's must stay below this. */
  readonly maxRatio: number;
  /** The large size's best time in a measurement must stay below this many milliseconds. */
  readonly backstop: number;
}

/** Timed runs of each size per measurement, interleaved. */
export const ROUNDS = 3;
/** Measurements before a ratio at or above the limit fails the test. */
export const ATTEMPTS = 3;

/**
 * Measures `spec` and fails unless the large size's best time over the small
 * size's is below `maxRatio` and below `backstop` milliseconds. One untimed
 * warm-up run of the small size first (code compiled, caches filled; a
 * large warm-up would only add the slowest run to every test), then a
 * measurement: `ROUNDS` rounds that time each size once, alternating which
 * goes first, so that a slow moment of the machine falls on both sizes
 * alike. Every round runs; then the best time of each size counts. A
 * measurement whose best large time is past the backstop fails at once,
 * without repeats. One whose ratio is at the limit or above is repeated, up
 * to `ATTEMPTS` in all: quadratic code fails every one of them, a disturbed
 * run of linear code does not.
 */
export async function expectLinearTime<Input, Result>(
  spec: LinearTime<Input, Result>,
): Promise<void> {
  const { sizes, run, check, maxRatio, backstop } = spec;
  const inputs = [await spec.input(sizes[0]), await spec.input(sizes[1])];
  const once = async (which: 0 | 1): Promise<number> => {
    const start = performance.now();
    const pending = run(inputs[which]!);
    const result = pending instanceof Promise ? await pending : pending;
    const elapsed = performance.now() - start;
    check?.(result, sizes[which]);
    return elapsed;
  };
  await once(0);

  const measured: string[] = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const best = [Infinity, Infinity];
    for (let round = 0; round < ROUNDS; round += 1) {
      for (const which of round % 2 === 0
        ? ([0, 1] as const)
        : ([1, 0] as const)) {
        best[which] = Math.min(best[which]!, await once(which));
      }
    }
    const [small, large] = best as [number, number];
    measured.push(
      `${(large / small).toFixed(2)} (${large.toFixed(1)} ms / ${small.toFixed(1)} ms)`,
    );
    expect(
      large,
      `size ${sizes[1]} takes longer than the backstop: ${measured.join(', ')}`,
    ).toBeLessThan(backstop);
    if (large / small < maxRatio) return;
  }
  expect.fail(
    `size ${sizes[1]} takes ${maxRatio} times as long as size ${sizes[0]} or more in all ${ATTEMPTS} measurements: ${measured.join(', ')}`,
  );
}

/** The best of `runs` timed runs of `run`, in milliseconds. */
export async function bestTime(
  runs: number,
  run: () => unknown,
): Promise<number> {
  let best = Infinity;
  for (let index = 0; index < runs; index += 1) {
    const start = performance.now();
    const pending = run();
    if (pending instanceof Promise) await pending;
    best = Math.min(best, performance.now() - start);
  }
  return best;
}
