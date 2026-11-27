import { expect, test } from 'vitest';
import { expectLinearTime, ROUNDS } from './timing.js';

/** Keeps the processor busy for `ms` milliseconds. */
function busy(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // Waiting.
  }
}

test('one slow large run past the backstop: every round still runs, and the best time counts', async () => {
  const runs: number[] = [];
  await expectLinearTime({
    sizes: [1, 4],
    input: (size) => size,
    run: (size) => {
      runs.push(size);
      // The first timed large run only is slow.
      if (size === 4 && runs.filter((n) => n === 4).length === 1) busy(60);
      return size;
    },
    maxRatio: 1e9,
    backstop: 50,
  });
  // The warm-up, then each size once per round.
  expect(runs).toHaveLength(1 + 2 * ROUNDS);
});

test('a best large time past the backstop fails after all rounds, without repeats', async () => {
  const runs: number[] = [];
  const measured = expectLinearTime({
    sizes: [1, 4],
    input: (size) => size,
    run: (size) => {
      runs.push(size);
      if (size === 4) busy(20);
      return size;
    },
    maxRatio: 1e9,
    backstop: 10,
  });
  await expect(measured).rejects.toThrow(
    /^size 4 takes longer than the backstop: /,
  );
  expect(runs).toHaveLength(1 + 2 * ROUNDS);
});
