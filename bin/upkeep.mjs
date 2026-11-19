#!/usr/bin/env node
import { main, UsageError } from '../src/cli.mjs';

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`upkeep: ${error.message}\nRun "upkeep --help" to see what is available.\n`);
    process.exitCode = 2;
  } else {
    process.stderr.write(`upkeep: ${error.message}\n`);
    process.exitCode = 1;
  }
}
