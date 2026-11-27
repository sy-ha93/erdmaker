import { configDefaults, defineConfig } from 'vitest/config';

const TESTS = 'packages/*/src/**/*.test.ts';
/** Time tests (see `packages/core/src/testing/timing.ts`). */
const PERF_TESTS = 'packages/*/src/**/*.perf.test.ts';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: [TESTS],
          exclude: [...configDefaults.exclude, PERF_TESTS],
          sequence: { groupOrder: 0 },
        },
      },
      {
        // After every other test file, one file at a time: the time tests
        // compare durations and must not compete for the processor.
        test: {
          name: 'perf',
          include: [PERF_TESTS],
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
