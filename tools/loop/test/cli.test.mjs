import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '../dist/cli.js');
const REPO_ROOT = path.resolve(__dirname, '../../..');

async function run(args, opts = {}) {
  try {
    const r = await exec(process.execPath, [CLI, ...args], {
      cwd: opts.cwd || REPO_ROOT,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, ...opts.env },
    });
    return { ...r, code: 0 };
  } catch (e) {
    if (opts.allowNonZero && e.stdout != null) {
      return { stdout: e.stdout, stderr: e.stderr || '', code: e.code ?? 1 };
    }
    throw e;
  }
}

test('loop --help exits 0 and documents doctor', async () => {
  const { stdout } = await run(['--help']);
  assert.match(stdout, /loop doctor/);
  assert.match(stdout, /loop-init/);
  assert.match(stdout, /Week-one/);
});

test('loop --version prints semver', async () => {
  const { stdout } = await run(['--version']);
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+/);
});

test('loop with no args prints week-one path', async () => {
  const { stdout } = await run([]);
  assert.match(stdout, /loop init/);
  assert.match(stdout, /loop doctor/);
  assert.match(stdout, /loop-init/);
});

test('loop audit --help pass-through works when monorepo dist exists', async () => {
  await access(path.join(REPO_ROOT, 'tools/loop-audit/dist/cli.js'));
  const { stdout } = await run(['audit', '--help']);
  assert.match(stdout, /loop-audit|Loop Readiness/i);
});

test('loop context passes --resume through without mutating the ledger', async () => {
  await access(path.join(REPO_ROOT, 'tools/loop-context/dist/cli.js'));
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-resume-'));
  const ledgerPath = path.join(dir, 'ledger.json');
  const original = `${JSON.stringify({
    goal: 'resume through front door',
    attempts: [],
    handoff: {
      schema: 1,
      state: 'running',
      brief: 'Confirm pass-through behavior.',
      nextStep: 'Read the rendered handoff.',
      focusPaths: ['tools/loop/src/cli.ts'],
      proof: ['loop-context is built.'],
      needs: [],
      turnsLeft: 1,
    },
  }, null, 2)}\n`;
  try {
    await writeFile(ledgerPath, original);
    const { stdout } = await run(['context', '--resume', '--ledger', ledgerPath]);
    assert.match(stdout, /# Loop Handoff/);
    assert.match(stdout, /Confirm pass-through behavior/);
    assert.equal(await readFile(ledgerPath, 'utf8'), original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop task front door exposes task help', async () => {
  const { stdout } = await run(['task', '--help']);
  assert.match(stdout, /executable Engineering Loop state machine/);
  assert.match(stdout, /loop task verify/);
});

test('loop task front door uses the requested state path', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-front-door-task-'));
  const statePath = path.join(dir, 'nested', 'task.json');
  try {
    const started = await run(['task', 'start', 'Front door task', '--state', statePath]);
    assert.match(started.stdout, /Started task: Front door task/);
    const status = await run(['task', 'status', '--json', '--state', statePath]);
    assert.equal(JSON.parse(status.stdout).goal, 'Front door task');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop doctor --json on repo root returns ready score', async () => {
  await access(path.join(REPO_ROOT, 'tools/loop-audit/dist/cli.js'));
  await access(path.join(REPO_ROOT, 'tools/loop-sync/dist/cli.js'));
  // doctor may exit 1 (warnings) on drift; still emits JSON
  const { stdout, code } = await run(['doctor', REPO_ROOT, '--json'], { allowNonZero: true });
  const report = JSON.parse(stdout);
  assert.equal(typeof report.ready.score, 'number');
  assert.ok(report.ready.score >= 40, `expected dogfood score >= 40, got ${report.ready.score}`);
  assert.ok(['healthy', 'warning', 'blocked'].includes(report.severity));
  assert.ok(Array.isArray(report.actions));
  assert.ok(report.actions.length <= 3);
  assert.ok(code < 2, `reference repo must not be blocked, exit ${code}`);
});

test('loop status --json includes recentRuns array', async () => {
  await access(path.join(REPO_ROOT, 'tools/loop-audit/dist/cli.js'));
  const { stdout } = await run(['status', REPO_ROOT, '--json']);
  const report = JSON.parse(stdout);
  assert.ok(Array.isArray(report.recentRuns));
  assert.ok(report.stateFile === 'STATE.md' || report.stateFile === null);
  assert.equal(typeof report.nextHint, 'string');
});

test('loop doctor on empty temp dir is blocked', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-doctor-empty-'));
  try {
    const { stdout, code } = await run(['doctor', dir, '--json'], { allowNonZero: true });
    const report = JSON.parse(stdout);
    assert.equal(report.severity, 'blocked');
    assert.equal(report.exitCode, 2);
    assert.equal(code, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
