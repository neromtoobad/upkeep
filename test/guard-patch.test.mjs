import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { protect, inspectPatch, restoreManifest, recordingFolder } from '../src/agent/guard-patch.mjs';
import { git } from '../src/workspace/worktree.mjs';

const PKG = { name: 'shop', dependencies: { 'date-fns': '^4.4.0', react: '^17.0.2' }, devDependencies: { vite: '^4.0.0' } };
const FLOW = '---\nurl: http://localhost:4173\n---\n\n# Check out\n\n## Pay\nPlace the order. Verify the page says "Thanks".\n';
const exists = (path) => access(path).then(() => true, () => false);

async function shop() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'upkeep-guard-')));
  const backupDir = await realpath(await mkdtemp(join(tmpdir(), 'upkeep-guard-backup-')));
  const write = async (path, text) => {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), text);
  };
  await write('package.json', `${JSON.stringify(PKG, null, 2)}\n`);
  await write('.gitignore', 'flows/output-*/\nnode_modules/\n');
  await write('src/Order.jsx', "import { format } from 'date-fns';\nexport const placed = (d) => format(d, 'DD/MM/YYYY');\n");
  await write('flows/checkout_test.md', FLOW);
  await write('flows/output-checkout/.internal/steps/1/actions.ndjson', '{"click":"Place order"}\n');
  await git(['init', '-q', '-b', 'main'], dir);
  await git(['config', 'user.name', 'test'], dir);
  await git(['config', 'user.email', 'test@example.com'], dir);
  await git(['add', '-A'], dir);
  await git(['commit', '-q', '-m', 'app'], dir);
  const guard = await protect({ projectDir: dir, flows: ['flows/checkout_test.md'], backupDir });
  return { dir, write, guard, cleanup: () => Promise.all([rm(dir, { recursive: true, force: true }), rm(backupDir, { recursive: true, force: true })]) };
}

test('recordingFolder is the output folder beside the flow', () => {
  assert.equal(recordingFolder('flows/checkout_test.md'), 'flows/output-checkout');
});

test('an honest fix: app files changed, nothing undone', async () => {
  const { dir, write, guard, cleanup } = await shop();
  try {
    await write('src/Order.jsx', "import { format } from 'date-fns';\nexport const placed = (d) => format(d, 'dd/MM/yyyy');\n");
    await write('src/dates.js', 'export const pattern = "dd/MM/yyyy";\n');
    const patch = await inspectPatch({ projectDir: dir, guard });
    assert.deepEqual(patch, { changed: ['src/Order.jsx', 'src/dates.js'], undone: [], addedPackages: [] });
  } finally {
    await cleanup();
  }
});

test('editing the flow to make it pass is undone', async () => {
  const { dir, write, guard, cleanup } = await shop();
  try {
    await write('flows/checkout_test.md', FLOW.replace('Verify the page says "Thanks".', 'Verify the page loads.'));
    const patch = await inspectPatch({ projectDir: dir, guard });
    assert.deepEqual(patch.changed, []);
    assert.equal(patch.undone.length, 1);
    assert.match(patch.undone[0], /edited flows\/checkout_test\.md/);
    assert.equal(await readFile(join(dir, 'flows/checkout_test.md'), 'utf8'), FLOW);
  } finally {
    await cleanup();
  }
});

test('tampering with a recording is undone even though git ignores recordings', async () => {
  const { dir, write, guard, cleanup } = await shop();
  try {
    await write('flows/output-checkout/.internal/steps/1/actions.ndjson', '{"click":"nothing"}\n');
    await write('flows/output-checkout/.internal/steps/2/extra.ndjson', '{}\n');
    const patch = await inspectPatch({ projectDir: dir, guard });
    assert.equal(patch.undone.length, 2);
    assert.equal(await readFile(join(dir, 'flows/output-checkout/.internal/steps/1/actions.ndjson'), 'utf8'), '{"click":"Place order"}\n');
    assert.equal(await exists(join(dir, 'flows/output-checkout/.internal/steps/2/extra.ndjson')), false);
  } finally {
    await cleanup();
  }
});

test('deleting the flow is undone', async () => {
  const { dir, guard, cleanup } = await shop();
  try {
    await rm(join(dir, 'flows/checkout_test.md'));
    const patch = await inspectPatch({ projectDir: dir, guard });
    assert.match(patch.undone[0], /edited flows\/checkout_test\.md/);
    assert.equal(await readFile(join(dir, 'flows/checkout_test.md'), 'utf8'), FLOW);
  } finally {
    await cleanup();
  }
});

test('downgrading the package or adding an override is undone; the real fix beside it is kept', async () => {
  const { dir, write, guard, cleanup } = await shop();
  try {
    await write('package.json', `${JSON.stringify({ ...PKG, dependencies: { ...PKG.dependencies, 'date-fns': '^1.30.1' }, overrides: { 'date-fns': '1.30.1' } }, null, 2)}\n`);
    await write('src/Order.jsx', '// touched\n');
    const patch = await inspectPatch({ projectDir: dir, guard });
    assert.deepEqual(patch.undone, ['changed the version of date-fns in package.json', 'edited overrides in package.json']);
    assert.deepEqual(patch.changed, ['src/Order.jsx']);
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')), PKG);
  } finally {
    await cleanup();
  }
});

test('keeping the old version under an alias, or rewriting the build script, is undone', async () => {
  const { dir, write, guard, cleanup } = await shop();
  try {
    const sneaky = {
      ...PKG,
      scripts: { build: 'echo skipped' },
      dependencies: { ...PKG.dependencies, 'date-fns-v1': 'npm:date-fns@1.30.1', 'old-dates': 'github:date-fns/date-fns#v1.30.1' },
    };
    await write('package.json', `${JSON.stringify(sneaky, null, 2)}\n`);
    const patch = await inspectPatch({ projectDir: dir, guard });
    assert.deepEqual(patch.undone, [
      'edited scripts in package.json',
      'added date-fns-v1 as "npm:date-fns@1.30.1" (only plain versions may be added, not aliases, URLs or files) in package.json',
      'added old-dates as "github:date-fns/date-fns#v1.30.1" (only plain versions may be added, not aliases, URLs or files) in package.json',
    ]);
    assert.deepEqual(patch.addedPackages, []);
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')), PKG);
  } finally {
    await cleanup();
  }
});

test('a round in which nothing changed is seen as such, even with edits left from an earlier round', async () => {
  const { dir, write, cleanup } = await shop();
  try {
    // Round 1 edits a file and is not committed (the check failed).
    await write('src/Order.jsx', '// first try\n');
    await write('src/notes.txt', 'left over\n');
    // Round 2 starts from there and the agent does nothing.
    const backupDir = await mkdtemp(join(tmpdir(), 'upkeep-guard-backup2-'));
    const second = await protect({ projectDir: dir, flows: ['flows/checkout_test.md'], backupDir });
    assert.deepEqual((await inspectPatch({ projectDir: dir, guard: second })).changed, []);
    // Round 3: one more edit, and a file removed.
    await write('src/Order.jsx', '// second try\n');
    await rm(join(dir, 'src/notes.txt'));
    assert.deepEqual((await inspectPatch({ projectDir: dir, guard: second })).changed, ['src/Order.jsx', 'src/notes.txt']);
    await rm(backupDir, { recursive: true, force: true });
  } finally {
    await cleanup();
  }
});

test('adding a new package is allowed and reported', async () => {
  const { dir, write, guard, cleanup } = await shop();
  try {
    await write('package.json', `${JSON.stringify({ ...PKG, dependencies: { ...PKG.dependencies, '@hookform/resolvers': '^5.0.0' } }, null, 2)}\n`);
    const patch = await inspectPatch({ projectDir: dir, guard });
    assert.deepEqual(patch.undone, []);
    assert.deepEqual(patch.addedPackages, ['@hookform/resolvers']);
    assert.deepEqual(patch.changed, []);
  } finally {
    await cleanup();
  }
});

test('a package.json left unreadable is put back', async () => {
  const { dir, write, guard, cleanup } = await shop();
  try {
    await write('package.json', '{ "name": ');
    const patch = await inspectPatch({ projectDir: dir, guard });
    assert.deepEqual(patch.undone, ['left package.json unreadable']);
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')), PKG);
  } finally {
    await cleanup();
  }
});

test('restoreManifest puts back removed dependencies and removed overrides', () => {
  const before = { dependencies: { a: '^1.0.0', b: '^2.0.0' }, overrides: { c: '3.0.0' } };
  const { restored, undone } = restoreManifest(before, { dependencies: { a: '^1.0.0' } });
  assert.deepEqual(restored, before);
  assert.deepEqual(undone, ['removed b from dependencies', 'edited overrides']);
});
