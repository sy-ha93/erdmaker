#!/usr/bin/env node
import { describeError, main, oneLine } from './main.js';

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  // `main` reports its own failures; anything else is one line, not a stack.
  process.stderr.write(
    `${oneLine(`Unexpected error: ${describeError(error)}`)}\n`,
  );
  process.exitCode = 2;
}
