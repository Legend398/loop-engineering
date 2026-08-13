import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(testDir, '../dist/cli.js');

async function freshState(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-task-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'custom', 'task.json');
}

function runTask(statePath, command, args = [], cwd) {
  return spawnSync(process.execPath, [cli, 'task', command, '--state', statePath, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    ...(cwd ? { cwd } : {}),
  });
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
}

async function freshGitRepo(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-task-git-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  runGit(dir, ['init', '--quiet']);
  runGit(dir, ['config', 'user.email', 'loop-tests@example.invalid']);
  runGit(dir, ['config', 'user.name', 'Loop Tests']);
  await writeFile(path.join(dir, '.gitignore'), '.loop/\n');
  await writeFile(path.join(dir, 'tracked.txt'), 'committed\n');
  runGit(dir, ['add', '.gitignore', 'tracked.txt']);
  runGit(dir, ['commit', '--quiet', '-m', 'fixture']);
  return { dir, statePath: path.join(dir, '.loop', 'task.json') };
}

function expectOk(result) {
  assert.equal(result.status, 0, result.stderr);
}

async function readState(statePath) {
  return JSON.parse(await readFile(statePath, 'utf8'));
}

async function advanceToVerify(statePath, cwd) {
  expectOk(runTask(statePath, 'start', ['Exercise task workflow'], cwd));
  expectOk(runTask(statePath, 'plan', ['Implement behavior', 'Run focused tests'], cwd));
  expectOk(runTask(statePath, 'implemented', ['Implemented behavior', '--file', 'tools/loop-context/src/task-cli.ts'], cwd));
}

async function advanceToFinish(statePath, cwd) {
  await advanceToVerify(statePath, cwd);
  expectOk(runTask(statePath, 'verify', ['--', process.execPath, '-e', 'console.log("verified")'], cwd));
  expectOk(runTask(statePath, 'check', ['pass', 'reviewed independently', '--checker', 'recorded reviewer label'], cwd));
}

async function expectStaleCheckReturnsToImplement(statePath, cwd) {
  const result = runTask(statePath, 'check', ['pass', 'stale review', '--checker', 'fixture checker'], cwd);
  assert.equal(result.status, 2, result.stderr);
  const state = await readState(statePath);
  assert.equal(state.task.phase, 'implement');
  assert.equal(state.task.status, 'active');
  assert.equal(state.task.verification, undefined);
  assert.equal(state.task.checker, undefined);

  const repeated = runTask(statePath, 'check', ['pass', 'still stale', '--checker', 'fixture checker'], cwd);
  assert.equal(repeated.status, 1);
  assert.match(repeated.stderr, /check requires an active task in phase checker; current state is implement\/active/);
}

test('task help documents every supported command', async (t) => {
  const statePath = await freshState(t);
  const result = runTask(statePath, 'help');
  expectOk(result);
  for (const command of ['start', 'status', 'plan', 'implemented', 'verify', 'check', 'replan', 'resume', 'finish', 'cancel']) {
    assert.match(result.stdout, new RegExp(`loop task ${command}`));
  }
});

test('task help truthfully describes checker labels as recorded role contracts, not authentication', async (t) => {
  const statePath = await freshState(t);
  const result = runTask(statePath, 'help');
  expectOk(result);
  assert.match(result.stdout, /Checker independence is a role contract recorded by label; it is not mechanically authenticated/);
});

test('task commands complete the legal workflow using one explicit state path', async (t) => {
  const statePath = await freshState(t);
  await advanceToFinish(statePath);
  expectOk(runTask(statePath, 'finish', ['Delivered with evidence']));

  const state = await readState(statePath);
  assert.equal(state.task.status, 'completed');
  assert.equal(state.task.result, 'Delivered with evidence');
  assert.equal(state.task.verification.status, 'pass');
  assert.equal(state.task.checker.label, 'recorded reviewer label');
});

test('status reports the current state without changing durable state', async (t) => {
  const statePath = await freshState(t);
  expectOk(runTask(statePath, 'start', ['Read status safely']));
  const before = await readFile(statePath, 'utf8');

  const result = runTask(statePath, 'status', ['--json']);

  expectOk(result);
  assert.equal(JSON.parse(result.stdout).phase, 'task');
  assert.equal(await readFile(statePath, 'utf8'), before);
  assert.ok(result.stdout.length < 24_000);
});

test('status JSON stays bounded and omits attempt and event history at maximum valid history sizes', async (t) => {
  const statePath = await freshState(t);
  expectOk(runTask(statePath, 'start', ['Bound heavy status output']));
  const state = await readState(statePath);
  const at = '2026-01-01T00:00:00.000Z';
  state.attempts = Array.from({ length: 10 }, (_, index) => ({
    iteration: index + 1,
    action: `historical action ${index}`,
    outcome: 'success',
    error: 'e'.repeat(4_000),
    timestamp: at,
  }));
  state.task.events = Array.from({ length: 20 }, (_, index) => ({
    at,
    phase: 'task',
    status: 'active',
    message: `${index} ${'m'.repeat(230)}`,
  }));
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

  const result = runTask(statePath, 'status', ['--json']);

  expectOk(result);
  const view = JSON.parse(result.stdout);
  assert.equal(Object.hasOwn(view, 'attempts'), false);
  assert.equal(Object.hasOwn(view, 'events'), false);
  assert.ok(result.stdout.length < 24_000);
});

test('resume renders a bounded handoff without changing durable state', async (t) => {
  const statePath = await freshState(t);
  expectOk(runTask(statePath, 'start', ['Resume safely']));
  const before = await readFile(statePath, 'utf8');

  const result = runTask(statePath, 'resume');

  expectOk(result);
  assert.match(result.stdout, /Loop Handoff/);
  assert.equal(await readFile(statePath, 'utf8'), before);
  assert.ok(result.stdout.length < 24_000);
});

test('implemented refuses to skip the plan transition', async (t) => {
  const statePath = await freshState(t);
  expectOk(runTask(statePath, 'start', ['Do not skip planning']));
  const result = runTask(statePath, 'implemented', ['Skipped plan']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /implemented requires an active task in phase implement; current state is task\/active/);
});

test('check refuses to skip same-iteration verification', async (t) => {
  const statePath = await freshState(t);
  await advanceToVerify(statePath);
  const result = runTask(statePath, 'check', ['pass', 'not actually checked', '--checker', 'label only']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /check requires an active task in phase checker; current state is verify\/active/);
});

test('finish refuses to skip checker evidence', async (t) => {
  const statePath = await freshState(t);
  await advanceToVerify(statePath);
  expectOk(runTask(statePath, 'verify', ['--', process.execPath, '-e', 'process.exit(0)']));
  const result = runTask(statePath, 'finish', ['Premature finish']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /finish requires an active task in phase finish; current state is checker\/active/);
});

test('finish rejects missing same-iteration checker evidence', async (t) => {
  const statePath = await freshState(t);
  await advanceToFinish(statePath);
  const state = await readState(statePath);
  delete state.task.checker;
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

  const result = runTask(statePath, 'finish', ['No checker proof']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /same-iteration verification PASS and checker PASS/);
});

test('finish rejects stale iteration evidence', async (t) => {
  const statePath = await freshState(t);
  await advanceToFinish(statePath);
  const state = await readState(statePath);
  state.task.iteration += 1;
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

  const result = runTask(statePath, 'finish', ['Stale proof']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /same-iteration verification PASS and checker PASS/);
});

test('verify executes a real passing child argv without a shell', async (t) => {
  const statePath = await freshState(t);
  await advanceToVerify(statePath);
  const result = runTask(statePath, 'verify', ['--', process.execPath, '-e', 'console.log("child-pass-marker")']);
  expectOk(result);
  assert.match(result.stdout, /child-pass-marker/);
  assert.equal((await readState(statePath)).task.phase, 'checker');
});

test('verify preserves repeated spaces and an empty argument in exact argv', async (t) => {
  const statePath = await freshState(t);
  await advanceToVerify(statePath);
  const script = 'console.log(JSON.stringify(process.argv.slice(1)))';
  const result = runTask(statePath, 'verify', ['--', process.execPath, '-e', script, 'alpha  beta', '']);

  expectOk(result);
  assert.match(result.stdout, /\["alpha  beta",""\]/);
  const state = await readState(statePath);
  assert.deepEqual(state.task.verification.command, [process.execPath, '-e', script, 'alpha  beta', '']);
});

test('unchanged Git workspace accepts check and finish with a bounded fingerprint', async (t) => {
  const { dir, statePath } = await freshGitRepo(t);
  await advanceToVerify(statePath, dir);
  expectOk(runTask(statePath, 'verify', ['--', process.execPath, '-e', 'process.exit(0)'], dir));

  const verified = await readState(statePath);
  assert.match(verified.task.verification.workspaceFingerprint, /^git-sha256:[a-f0-9]{64}$/);
  assert.ok(verified.task.verification.workspaceFingerprint.length < 100);

  expectOk(runTask(statePath, 'check', ['pass', 'workspace unchanged', '--checker', 'fixture checker'], dir));
  expectOk(runTask(statePath, 'finish', ['Delivered unchanged workspace'], dir));
  assert.equal((await readState(statePath)).task.status, 'completed');
});

test('tracked edit after verification invalidates evidence before check', async (t) => {
  const { dir, statePath } = await freshGitRepo(t);
  await advanceToVerify(statePath, dir);
  expectOk(runTask(statePath, 'verify', ['--', process.execPath, '-e', 'process.exit(0)'], dir));
  await writeFile(path.join(dir, 'tracked.txt'), 'edited after verification\n');

  await expectStaleCheckReturnsToImplement(statePath, dir);
});

const TRACKED_MUTATIONS = [
  ['staged add', async (dir) => {
    await writeFile(path.join(dir, 'staged-add.txt'), 'staged after verification\n');
    runGit(dir, ['add', 'staged-add.txt']);
  }],
  ['staged edit', async (dir) => {
    await writeFile(path.join(dir, 'tracked.txt'), 'staged edit after verification\n');
    runGit(dir, ['add', 'tracked.txt']);
  }],
  ['staged delete', async (dir) => runGit(dir, ['rm', '--quiet', 'tracked.txt'])],
  ['unstaged tracked deletion', async (dir) => unlink(path.join(dir, 'tracked.txt'))],
];

for (const [label, mutate] of TRACKED_MUTATIONS) {
  test(`${label} after verification invalidates evidence before check`, async (t) => {
    const { dir, statePath } = await freshGitRepo(t);
    await advanceToVerify(statePath, dir);
    expectOk(runTask(statePath, 'verify', ['--', process.execPath, '-e', 'process.exit(0)'], dir));

    await mutate(dir);

    await expectStaleCheckReturnsToImplement(statePath, dir);
  });
}

for (const mutation of ['add', 'edit', 'delete']) {
  test(`untracked ${mutation} after verification invalidates evidence before check`, async (t) => {
    const { dir, statePath } = await freshGitRepo(t);
    const untracked = path.join(dir, 'untracked.txt');
    if (mutation !== 'add') await writeFile(untracked, 'untracked baseline\n');
    await advanceToVerify(statePath, dir);
    expectOk(runTask(statePath, 'verify', ['--', process.execPath, '-e', 'process.exit(0)'], dir));

    if (mutation === 'add') await writeFile(untracked, 'added after verification\n');
    if (mutation === 'edit') await writeFile(untracked, 'edited after verification\n');
    if (mutation === 'delete') await unlink(untracked);

    await expectStaleCheckReturnsToImplement(statePath, dir);
  });
}

test('workspace change after checker invalidates evidence before finish', async (t) => {
  const { dir, statePath } = await freshGitRepo(t);
  await advanceToFinish(statePath, dir);
  await writeFile(path.join(dir, 'tracked.txt'), 'edited after checker\n');

  const result = runTask(statePath, 'finish', ['Must not accept stale evidence'], dir);
  assert.equal(result.status, 2, result.stderr);
  const state = await readState(statePath);
  assert.equal(state.task.phase, 'implement');
  assert.equal(state.task.status, 'active');
  assert.equal(state.task.verification, undefined);
  assert.equal(state.task.checker, undefined);
});

test('non-Git workspace retains the existing task workflow', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-task-non-git-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const statePath = path.join(dir, '.loop', 'task.json');

  await advanceToFinish(statePath, dir);
  expectOk(runTask(statePath, 'finish', ['Delivered outside Git'], dir));
  const state = await readState(statePath);
  assert.equal(state.task.status, 'completed');
  assert.equal(state.task.verification.workspaceFingerprint, undefined);
});

test('verify rejects a path-qualified Windows command shim without invoking a shell', { skip: process.platform !== 'win32' }, async (t) => {
  const statePath = await freshState(t);
  await advanceToVerify(statePath);
  const result = runTask(statePath, 'verify', ['--', 'C:\\fake-tools\\npm.cmd', '--version']);

  assert.equal(result.status, 2, result.stderr);
  const state = await readState(statePath);
  assert.equal(state.task.phase, 'implement');
  assert.equal(state.task.verification.exitCode, null);
  assert.match(state.task.verification.outputTail, /Path-qualified \.cmd\/\.bat verification is not supported without a shell/);
});

test('failed verification returns workflow exit 2 and loops to implementation', async (t) => {
  const statePath = await freshState(t);
  await advanceToVerify(statePath);
  const result = runTask(statePath, 'verify', ['--', process.execPath, '-e', 'console.error("child-fail-marker"); process.exit(7)']);
  assert.equal(result.status, 2, result.stderr);
  const state = await readState(statePath);
  assert.equal(state.task.phase, 'implement');
  assert.equal(state.task.verification.status, 'fail');
  assert.match(state.task.verification.outputTail, /child-fail-marker/);
});

test('failed checker returns workflow exit 2 and loops to implementation', async (t) => {
  const statePath = await freshState(t);
  await advanceToVerify(statePath);
  expectOk(runTask(statePath, 'verify', ['--', process.execPath, '-e', 'process.exit(0)']));
  const result = runTask(statePath, 'check', ['fail', 'acceptance criterion missing', '--checker', 'qa-note']);
  assert.equal(result.status, 2, result.stderr);
  const state = await readState(statePath);
  assert.equal(state.task.phase, 'implement');
  assert.equal(state.task.checker.status, 'fail');
});

test('repeated verification failures eventually breaker-block the plan', async (t) => {
  const statePath = await freshState(t);
  await advanceToVerify(statePath);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const failed = runTask(statePath, 'verify', ['--', process.execPath, '-e', 'console.error("same deterministic failure"); process.exit(1)']);
    assert.equal(failed.status, 2, failed.stderr);
    if (attempt < 3) {
      expectOk(runTask(statePath, 'implemented', [`Retry ${attempt}`]));
    }
  }
  const state = await readState(statePath);
  assert.equal(state.task.phase, 'plan');
  assert.equal(state.task.status, 'blocked');
  assert.match(state.task.blocker, /circuit breaker stagnation/);
});

test('replan restores an active plan and resets the failure epoch', async (t) => {
  const statePath = await freshState(t);
  await advanceToVerify(statePath);
  runTask(statePath, 'verify', ['--', process.execPath, '-e', 'process.exit(1)']);

  const result = runTask(statePath, 'replan', ['Use a different approach']);

  expectOk(result);
  const state = await readState(statePath);
  assert.equal(state.task.phase, 'plan');
  assert.equal(state.task.status, 'active');
  assert.deepEqual(state.attempts, []);
  assert.equal(state.task.verification, undefined);
});

test('resume after replan instructs only recording a revised plan', async (t) => {
  const statePath = await freshState(t);
  await advanceToVerify(statePath);
  runTask(statePath, 'verify', ['--', process.execPath, '-e', 'process.exit(1)']);
  expectOk(runTask(statePath, 'replan', ['Change the approach']));

  const result = runTask(statePath, 'resume');

  expectOk(result);
  assert.match(result.stdout, /Record the revised implementation plan with loop task plan/);
  assert.doesNotMatch(result.stdout, /or begin implementation/);
});

test('implemented rejects project paths outside the repository', async (t) => {
  const statePath = await freshState(t);
  expectOk(runTask(statePath, 'start', ['Keep paths scoped']));
  expectOk(runTask(statePath, 'plan', ['Record changed files']));
  const result = runTask(statePath, 'implemented', ['Unsafe path', '--file', '../outside.txt']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /normalized project-relative path/);
});

test('start rejects oversized objective input', async (t) => {
  const statePath = await freshState(t);
  const result = runTask(statePath, 'start', ['x'.repeat(501)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /objective must be at most 500 characters/);
});

test('start refuses to replace an active task', async (t) => {
  const statePath = await freshState(t);
  expectOk(runTask(statePath, 'start', ['Original active task']));
  const result = runTask(statePath, 'start', ['Replacement task']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cannot replace task\/active task state/);
});

test('start refuses to replace a breaker-blocked task', async (t) => {
  const statePath = await freshState(t);
  await advanceToVerify(statePath);
  for (let attempt = 1; attempt <= 3; attempt++) {
    runTask(statePath, 'verify', ['--', process.execPath, '-e', 'console.error("blocked failure"); process.exit(1)']);
    if (attempt < 3) expectOk(runTask(statePath, 'implemented', [`Retry ${attempt}`]));
  }
  const result = runTask(statePath, 'start', ['Replacement task']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cannot replace plan\/blocked task state/);
});

test('start replaces a cancelled terminal task', async (t) => {
  const statePath = await freshState(t);
  expectOk(runTask(statePath, 'start', ['Disposable task']));
  expectOk(runTask(statePath, 'cancel', ['No longer needed']));

  const result = runTask(statePath, 'start', ['Replacement task']);

  expectOk(result);
  const state = await readState(statePath);
  assert.equal(state.goal, 'Replacement task');
  assert.equal(state.task.status, 'active');
  assert.equal(state.task.phase, 'task');
});

test('start replaces a completed terminal task', async (t) => {
  const statePath = await freshState(t);
  await advanceToFinish(statePath);
  expectOk(runTask(statePath, 'finish', ['First task completed']));

  const result = runTask(statePath, 'start', ['Next task']);

  expectOk(result);
  const state = await readState(statePath);
  assert.equal(state.goal, 'Next task');
  assert.equal(state.task.status, 'active');
  assert.equal(state.task.phase, 'task');
});
