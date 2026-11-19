import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFixer } from '../src/agent/fix-loop.mjs';
import { askAgent, resolveAgent } from '../src/agent/ask-agent.mjs';
import { CheckUnavailable } from '../src/loop/land-upgrades.mjs';
import { git } from '../src/workspace/worktree.mjs';

const UNIT = { id: 'date-fns', packages: [{ name: 'date-fns', from: '1.30.1', to: '4.4.0', kind: 'major', section: 'dependencies', nextSpec: '^4.4.0' }] };
const FAIL = { outcome: 'fail', stage: 'kane', failing: ['checkout_test.md'], summary: '1 of 1 flows failed: checkout_test.md: blank page', flows: [{ flow: 'checkout_test.md', status: 'failed', message: 'blank page' }], packs: [] };
const PASS = { outcome: 'pass', failing: [], summary: '1 of 1 flows passed', flows: [{ flow: 'checkout_test.md', status: 'passed' }] };
const AGENT = { id: 'test', name: 'Test Agent' };

// A real git project on disk; the agent and the check are stand-ins. The
// stand-in agent is a function that edits files the way a coding agent would.
async function setup({ edits, verdicts }) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'upkeep-fix-')));
  const runDir = await realpath(await mkdtemp(join(tmpdir(), 'upkeep-fix-run-')));
  const write = async (path, text) => {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), text);
  };
  await write('package.json', `${JSON.stringify({ name: 'shop', dependencies: { 'date-fns': '^4.4.0' } }, null, 2)}\n`);
  await write('src/Order.jsx', "import { format } from 'date-fns';\nexport const placed = (d) => format(d, 'DD/MM/YYYY');\n");
  await write('flows/checkout_test.md', '---\nurl: http://localhost:4173\n---\n\n# Check out\n\n## Pay\nVerify "Thanks".\n');
  await git(['init', '-q', '-b', 'main'], dir);
  await git(['config', 'user.name', 'test'], dir);
  await git(['config', 'user.email', 'test@example.com'], dir);
  await git(['add', '-A'], dir);
  await git(['commit', '-q', '-m', 'app'], dir);

  const calls = { apply: [], check: [], prompts: [], said: [], recorded: [] };
  let round = 0;
  const context = {
    work: { projectDir: dir },
    config: { flows: ['flows/checkout_test.md'] },
    runDir,
    apply: async (units) => calls.apply.push(units.map((u) => u.id)),
    check: async (units, options) => {
      calls.check.push(options);
      return verdicts[calls.check.length - 1];
    },
    say: (line) => calls.said.push(line),
    record: async (entry) => calls.recorded.push(entry),
  };
  const ask = async ({ prompt }) => {
    calls.prompts.push(prompt);
    const edit = edits[round];
    round += 1;
    if (edit === 'unavailable') return { ok: false, text: '', seconds: 1, problem: 'Test Agent is not installed or not on PATH' };
    if (edit) await edit(write);
    return { ok: true, text: 'Changed the format tokens.', seconds: 2 };
  };
  return { dir, runDir, calls, context, ask, cleanup: () => Promise.all([rm(dir, { recursive: true, force: true }), rm(runDir, { recursive: true, force: true })]) };
}

const goodFix = (write) => write('src/Order.jsx', "import { format } from 'date-fns';\nexport const placed = (d) => format(d, 'dd/MM/yyyy');\n");

test('Kane fails, the agent fixes the app, Kane passes: fixed in one round', async () => {
  const s = await setup({ edits: [goodFix], verdicts: [PASS] });
  try {
    const repair = await makeFixer({ agent: AGENT, ask: s.ask })([UNIT], FAIL, s.context);
    assert.equal(repair.fixed, true);
    assert.equal(repair.rounds, 1);
    assert.deepEqual(repair.changed, ['src/Order.jsx']);
    assert.deepEqual(s.calls.apply, [['date-fns']], 'the culprit is put in place before the agent starts');
    assert.equal(s.calls.check[0].keepManifest, true, 're-check keeps the versions and the agent edits');
    assert.match(s.calls.prompts[0], /Kane: blank page/);
    assert.match(s.calls.prompts[0], /src\/Order\.jsx:1/);
    assert.match(await readFile(join(s.runDir, 'agent/date-fns/round-1-task.md'), 'utf8'), /date-fns: 1\.30\.1 -> 4\.4\.0/);
    assert.match(await readFile(join(s.runDir, 'agent/date-fns/round-1-reply.md'), 'utf8'), /Changed the format tokens/);
  } finally {
    await s.cleanup();
  }
});

test('Kane’s new failure goes back to the agent for a second round', async () => {
  const stillBroken = { ...FAIL, summary: '1 of 1 flows failed: checkout_test.md: date shows as "19/11/26"', flows: [{ flow: 'checkout_test.md', status: 'failed', message: 'date shows as "19/11/26"' }] };
  const s = await setup({
    edits: [(write) => write('src/Order.jsx', '// first try\n'), goodFix],
    verdicts: [stillBroken, PASS],
  });
  try {
    const repair = await makeFixer({ agent: AGENT, ask: s.ask })([UNIT], FAIL, s.context);
    assert.equal(repair.fixed, true);
    assert.equal(repair.rounds, 2);
    assert.match(s.calls.prompts[1], /Kane: date shows as "19\/11\/26"/, 'round 2 carries the NEW failure');
    assert.match(s.calls.prompts[1], /Round 1: you changed src\/Order\.jsx\. Result: 1 of 1 flows failed/);
    assert.match(s.calls.prompts[1], /This is round 2\./);
  } finally {
    await s.cleanup();
  }
});

test('an agent that rewrites the flow instead of the app gets it undone and nothing lands', async () => {
  const s = await setup({ edits: [(write) => write('flows/checkout_test.md', '# always passes\n')], verdicts: [] });
  try {
    const repair = await makeFixer({ agent: AGENT, ask: s.ask })([UNIT], FAIL, s.context);
    assert.equal(repair.fixed, false);
    assert.equal(repair.reason, 'the agent only changed things it may not change');
    assert.equal(s.calls.check.length, 0, 'no Kane run is spent on a cheat');
    assert.match(await readFile(join(s.dir, 'flows/checkout_test.md'), 'utf8'), /Verify "Thanks"/);
    assert.ok(s.calls.said.some((line) => /undone: the agent edited flows\/checkout_test\.md/.test(line)));
  } finally {
    await s.cleanup();
  }
});

test('an agent that changes nothing ends the loop', async () => {
  const s = await setup({ edits: [null], verdicts: [] });
  try {
    const repair = await makeFixer({ agent: AGENT, ask: s.ask })([UNIT], FAIL, s.context);
    assert.deepEqual([repair.fixed, repair.rounds, repair.reason], [false, 1, 'the agent changed nothing']);
  } finally {
    await s.cleanup();
  }
});

test('rounds run out: not fixed, with the last failure', async () => {
  const edit = (n) => (write) => write('src/Order.jsx', `// try ${n}\n`);
  const s = await setup({ edits: [edit(1), edit(2)], verdicts: [FAIL, FAIL] });
  try {
    const repair = await makeFixer({ agent: AGENT, ask: s.ask, maxRounds: 2 })([UNIT], FAIL, s.context);
    assert.deepEqual([repair.fixed, repair.rounds, repair.reason], [false, 2, 'still failing after 2 rounds with the agent']);
    assert.equal(repair.verdict, FAIL);
  } finally {
    await s.cleanup();
  }
});

test('a missing agent is reported, not treated as a failed fix attempt', async () => {
  const s = await setup({ edits: ['unavailable'], verdicts: [] });
  try {
    const repair = await makeFixer({ agent: AGENT, ask: s.ask })([UNIT], FAIL, s.context);
    assert.equal(repair.fixed, false);
    assert.match(repair.reason, /not installed or not on PATH/);
  } finally {
    await s.cleanup();
  }
});

test('if Kane cannot run after the fix, the run stops rather than guessing', async () => {
  const s = await setup({ edits: [goodFix], verdicts: [{ outcome: 'error', summary: 'Kane CLI is out of credits' }] });
  try {
    await assert.rejects(makeFixer({ agent: AGENT, ask: s.ask })([UNIT], FAIL, s.context), (error) => error instanceof CheckUnavailable);
  } finally {
    await s.cleanup();
  }
});

test('askAgent runs a command of your own, with the task on stdin or in a file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'upkeep-ask-'));
  try {
    const onStdin = await askAgent({ agent: resolveAgent('cat > got.md && echo "read it"'), prompt: 'fix the dates', cwd: dir });
    assert.deepEqual([onStdin.ok, onStdin.text], [true, 'read it']);
    assert.equal(await readFile(join(dir, 'got.md'), 'utf8'), 'fix the dates');

    const inFile = await askAgent({ agent: resolveAgent('cp {prompt_file} copy.md && echo done'), prompt: 'fix the dates', cwd: dir });
    assert.equal(inFile.ok, true);
    assert.equal(await readFile(join(dir, 'copy.md'), 'utf8'), 'fix the dates');

    const failing = await askAgent({ agent: resolveAgent('echo "rate limited" >&2; exit 7'), prompt: 'x', cwd: dir });
    assert.equal(failing.ok, false);
    assert.match(failing.problem, /exited 7: rate limited/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveAgent knows Claude Code (file tools only, no shell) and Codex (sandboxed)', () => {
  const claude = resolveAgent('claude');
  assert.equal(claude.name, 'Claude Code');
  assert.ok(claude.args.includes('-p'));
  assert.equal(claude.args[claude.args.indexOf('--allowedTools') + 1], 'Read,Edit,Write,Glob,Grep');
  assert.deepEqual(claude.reply(JSON.stringify({ result: ' Fixed. ', total_cost_usd: 0.12 })), { text: 'Fixed.', costUsd: 0.12 });
  assert.equal(resolveAgent('codex').name, 'Codex CLI');
  assert.deepEqual(resolveAgent('codex').args, ['exec', '--sandbox', 'workspace-write', '-']);
  assert.throws(() => resolveAgent(''), /no agent given/);
});
