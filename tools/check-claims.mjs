#!/usr/bin/env node
// Checks the README against the repository. Prints PASS or FAIL per check and
// exits 1 if anything fails.
//
//   node tools/check-claims.mjs           check
//   node tools/check-claims.mjs --write   rewrite the claims table in the README first
//
// What it checks:
//   1. Every claim in tools/claims.json points at code that exists, and the
//      README table carries the same file:line.
//   2. Every published run in evidence/ obeys the rules the README states:
//      nothing landed without a passing check on exactly that set, and nothing
//      was blamed without a full (heal-on) failing check.
//   3. evidence/ holds no email address, no home folder path, no Kane pack.
//   4. package.json declares no dependencies.

import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFile(join(root, path), 'utf8');
const results = [];
const pass = (what) => results.push(['PASS', what]);
const fail = (what) => results.push(['FAIL', what]);

// ---- 1. claims -----------------------------------------------------------
const claims = JSON.parse(await read('tools/claims.json'));
const rows = [];
for (const claim of claims) {
  let text;
  try {
    text = await read(claim.file);
  } catch {
    fail(`claim points at a missing file: ${claim.file}`);
    continue;
  }
  const index = text.split('\n').findIndex((line) => line.includes(claim.find));
  if (index === -1) {
    fail(`claim "${claim.claim.slice(0, 60)}…": "${claim.find}" is no longer in ${claim.file}`);
    continue;
  }
  rows.push({ ...claim, line: index + 1 });
}
const table = ['| Claim | Where in code | Checked by |', '|---|---|---|', ...rows.map((row) => `| ${row.claim} | \`${row.file}:${row.line}\` | ${row.check} |`)].join('\n');

const START = '<!-- claims:start -->';
const END = '<!-- claims:end -->';
let readme = await read('README.md');
if (process.argv.includes('--write')) {
  if (!readme.includes(START) || !readme.includes(END)) {
    fail('README has no claims markers to write between');
  } else {
    readme = `${readme.slice(0, readme.indexOf(START) + START.length)}\n${table}\n${readme.slice(readme.indexOf(END))}`;
    await writeFile(join(root, 'README.md'), readme);
  }
}
let stale = 0;
for (const row of rows) {
  if (!readme.includes(`\`${row.file}:${row.line}\``)) {
    stale += 1;
    fail(`README is out of date for ${row.file}: the code is at line ${row.line} (run with --write)`);
  }
}
if (rows.length === claims.length && stale === 0) pass(`${rows.length} claims point at code that exists, and the README has the same lines`);

// Paths the claims name as checks must exist too.
const named = new Set();
for (const claim of claims) for (const match of claim.check.matchAll(/`((?:test|evidence|tools)\/[^`*\s]+)`/g)) named.add(match[1]);
let missing = 0;
for (const path of named) {
  try {
    await stat(join(root, path));
  } catch {
    missing += 1;
    fail(`a claim names ${path}, which does not exist`);
  }
}
if (missing === 0) pass(`${named.size} files named as checks exist`);

// ---- 2. the published runs obey the rules ---------------------------------
const key = (ids) => [...ids].sort().join(',');
let runs = [];
try {
  runs = (await readdir(join(root, 'evidence'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
} catch {
  runs = [];
}
if (runs.length === 0) fail('evidence/ holds no runs');

for (const run of runs) {
  let ledger;
  try {
    ledger = (await read(`evidence/${run}/ledger.ndjson`)).split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    fail(`evidence/${run} has no readable ledger`);
    continue;
  }
  const checks = ledger.filter((entry) => entry.type === 'check');
  const problems = [];

  const landed = ledger.filter((entry) => entry.type === 'landed');
  for (const entry of landed) {
    const before = ledger.slice(0, ledger.indexOf(entry));
    const proof = before.findLast((e) => e.type === 'check' && key(e.units) === key(entry.units));
    if (!proof || proof.outcome !== 'pass' || proof.upTo) problems.push(`landed ${key(entry.units)} without a passing check on exactly that set`);
    else if (proof.flows?.some((flow) => flow.status !== 'passed')) problems.push(`landed ${key(entry.units)} although a flow did not pass`);
  }

  const blamed = [...ledger.filter((entry) => entry.type === 'blocked'), ...landed.filter((entry) => entry.fixed)];
  for (const entry of blamed) {
    const before = ledger.slice(0, ledger.indexOf(entry));
    const failure = before.findLast((e) => e.type === 'check' && e.outcome === 'fail' && key(e.units) === key(entry.units) && (e.speed ?? 'full') === 'full');
    if (!failure) problems.push(`${key(entry.units)} was blamed without a full failing check`);
  }

  if (!checks[0] || checks[0].units.length !== 0 || checks[0].outcome !== 'pass') problems.push('the run did not start from a passing check of the app as it was');

  if (problems.length > 0) for (const problem of problems) fail(`evidence/${run}: ${problem}`);
  else pass(`evidence/${run}: ${checks.length} checks, ${landed.length} landed, ${blamed.length} blamed; every one backed by the right check`);
}

// ---- 3. nothing private in evidence/ --------------------------------------
async function walk(dir, out = []) {
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, out);
    else out.push(path);
  }
  return out;
}
if (runs.length > 0) {
  const files = await walk('evidence');
  const leaks = [];
  for (const file of files) {
    if (file.endsWith('.evidence')) leaks.push(`${file} is a Kane evidence pack`);
    if (!/\.(md|json|ndjson|txt|ya?ml)$/.test(file)) continue;
    const text = await read(file);
    const emails = (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g) ?? []).filter((email) => !email.endsWith('@example.com') && !/@(\d|v\d)/.test(email));
    if (emails.length > 0) leaks.push(`${file} contains an email address`);
    if (/\/(Users|home)\/[A-Za-z0-9._-]+\//.test(text)) leaks.push(`${file} contains a home folder path`);
  }
  if (leaks.length > 0) for (const leak of leaks) fail(leak);
  else pass(`evidence/: ${files.length} files, no email address, no home folder path, no evidence pack`);
}

// ---- 4. no dependencies ----------------------------------------------------
const pkg = JSON.parse(await read('package.json'));
if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) fail('package.json declares dependencies');
else pass('package.json declares no dependencies');

for (const [status, what] of results) console.log(`${status}  ${what}`);
const failed = results.filter(([status]) => status === 'FAIL').length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
