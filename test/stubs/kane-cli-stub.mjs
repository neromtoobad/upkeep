#!/usr/bin/env node
// Test stand-in for the kane-cli binary. It prints the stream named by
// KANE_STUB_SCRIPT, one scripted run per invocation, so run-suite.mjs can be
// tested through a real child process without a browser or credits.
// It is never used outside test/.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
if (args[0] === 'balance') {
  console.log('Available credits: 1000');
  process.exit(0);
}

const script = JSON.parse(readFileSync(process.env.KANE_STUB_SCRIPT, 'utf8'));
const counter = `${process.env.KANE_STUB_SCRIPT}.count`;
const call = existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0;
writeFileSync(counter, String(call + 1));
writeFileSync(`${process.env.KANE_STUB_SCRIPT}.args.${call}`, JSON.stringify(args));

const run = script[Math.min(call, script.length - 1)];
for (const event of run.events) console.log(JSON.stringify(event));
if (run.stderr) console.error(run.stderr);
process.exit(run.exit);
