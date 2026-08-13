import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolveDailyBudgetFromPattern } from '../dist/budget-resolver.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(testDir, '../dist/cli.js');
const onExceedCaptureScript = path.join(testDir, 'fixtures/on-exceed-capture.mjs');

async function freshDir() {
  return mkdtemp(path.join(tmpdir(), 'loop-context-cli-daily-'));
}

const stagnationLedger = JSON.stringify({
  goal: 'x',
  startedAt: '2026-01-01T00:00:00.000Z',
  attempts: [
    { iteration: 1, action: 'a', outcome: 'failure', error: 'boom' },
    { iteration: 2, action: 'a', outcome: 'failure', error: 'boom' },
    { iteration: 3, action: 'a', outcome: 'failure', error: 'boom' },
  ],
});

function runCli(args, input = stagnationLedger) {
  return spawnSync(process.execPath, [cli, ...args], {
    input,
    encoding: 'utf8',
  });
}

test('cli --check trips stagnation with default threshold', () => {
  const r = runCli(['--check', '--json']);
  assert.equal(r.status, 2);
  const decision = JSON.parse(r.stdout);
  assert.equal(decision.trigger, 'stagnation');
});

test('cli rejects invalid --stagnation values before running the breaker', () => {
  const r = runCli(['--check', '--stagnation', 'nope', '--json']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--stagnation must be a positive integer/);
});

test('cli rejects invalid --no-progress values', () => {
  const r = runCli(['--check', '--no-progress', '0', '--json']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--no-progress must be a positive integer/);
});

test('cli rejects invalid --max-iterations values', () => {
  const r = runCli(['--check', '--max-iterations', '1.5', '--json']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--max-iterations must be a positive integer/);
});

test('cli rejects missing numeric flag values', () => {
  const r = runCli(['--check', '--stagnation']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--stagnation requires a positive integer value/);
});

const cheapLedger = JSON.stringify({
  goal: 'x',
  startedAt: '2026-01-01T00:00:00.000Z',
  attempts: [{ iteration: 1, action: 'a', outcome: 'success', tokensUsed: 100 }],
});

test('cli resolves --token-budget from --budget-from-pattern', () => {
  const r = runCli(
    ['--check', '--budget-from-pattern', 'ci-sweeper', '--budget-level', 'L2', '--json'],
    cheapLedger,
  );
  assert.equal(r.status, 0);
  const decision = JSON.parse(r.stdout);
  assert.equal(decision.escalate, false);
});

test('cli --token-budget wins over --budget-from-pattern when both are given', () => {
  const r = runCli(
    ['--check', '--budget-from-pattern', 'ci-sweeper', '--token-budget', '50', '--json'],
    cheapLedger,
  );
  assert.equal(r.status, 2);
  const decision = JSON.parse(r.stdout);
  assert.equal(decision.trigger, 'token-budget');
});

test('cli --budget-from-pattern surfaces loop-cost\'s unknown-pattern error', () => {
  const r = runCli(['--check', '--budget-from-pattern', 'not-a-pattern'], cheapLedger);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unknown pattern: not-a-pattern/);
});

test('cli --daily-budget-from-pattern escalates once the daily cap is reached', async () => {
  const dir = await freshDir();
  const dailyCap = await resolveDailyBudgetFromPattern({ pattern: 'ci-sweeper', level: 'L2' });
  // Pre-seed today's spend right at the cap so this run's single-token delta tips it over.
  await writeFile(
    path.join(dir, 'daily-spend.ci-sweeper.json'),
    JSON.stringify({ date: new Date().toISOString().slice(0, 10), tokensUsedToday: dailyCap }),
  );

  const r = runCli(
    [
      '--check', '--daily-budget-from-pattern', 'ci-sweeper', '--budget-level', 'L2',
      '--daily-state-dir', dir, '--json',
    ],
    cheapLedger,
  );
  assert.equal(r.status, 2);
  const decision = JSON.parse(r.stdout);
  assert.equal(decision.trigger, 'daily-budget');
});

test('cli --daily-budget-from-pattern does not override an existing per-run trigger', async () => {
  const dir = await freshDir();
  const dailyCap = await resolveDailyBudgetFromPattern({ pattern: 'ci-sweeper', level: 'L2' });
  await writeFile(
    path.join(dir, 'daily-spend.ci-sweeper.json'),
    JSON.stringify({ date: new Date().toISOString().slice(0, 10), tokensUsedToday: dailyCap * 10 }),
  );

  const r = runCli([
    '--check', '--daily-budget-from-pattern', 'ci-sweeper', '--budget-level', 'L2',
    '--daily-state-dir', dir, '--json',
  ]);
  assert.equal(r.status, 2);
  const decision = JSON.parse(r.stdout);
  assert.equal(decision.trigger, 'stagnation');
});

test('cli --daily-budget-from-pattern uses stable run and attempt identity', async () => {
  const dir = await freshDir();
  const args = [
    '--check', '--daily-budget-from-pattern', 'ci-sweeper', '--budget-level', 'L2',
    '--daily-state-dir', dir, '--json',
  ];
  const first = runCli(args, cheapLedger);
  const sameLedgerWithReorderedAttemptFields = JSON.stringify({
    goal: 'changed wording does not change identity',
    startedAt: '2026-01-01T00:00:00.000Z',
    attempts: [{ tokensUsed: 100, outcome: 'failure', action: 'edited action', iteration: 1 }],
  });
  const second = runCli(args, sameLedgerWithReorderedAttemptFields);
  const distinctRun = runCli(args, JSON.stringify({
    goal: 'x',
    startedAt: '2026-01-01T00:00:01.000Z',
    attempts: [{ iteration: 1, action: 'a', outcome: 'success', tokensUsed: 100 }],
  }));
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(distinctRun.status, 0, distinctRun.stderr);

  const state = JSON.parse(await readFile(path.join(dir, 'daily-spend.ci-sweeper.json'), 'utf8'));
  assert.equal(state.tokensUsedToday, 200);
  assert.equal(state.eventIds.length, 2);
});

test('cli --daily-budget-from-pattern requires a stable run identity', async () => {
  const dir = await freshDir();
  const result = runCli([
    '--check', '--daily-budget-from-pattern', 'ci-sweeper', '--budget-level', 'L2',
    '--daily-state-dir', dir,
  ], JSON.stringify({
    goal: 'x',
    attempts: [{ iteration: 1, action: 'a', outcome: 'success', tokensUsed: 100 }],
  }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires ledger\.startedAt.*stable run identity/);
});

test('cli --on-exceed pipes the escalation decision to the script as JSON', async () => {
  const dir = await freshDir();
  const outFile = path.join(dir, 'captured.json');

  const r = runCli(['--check', '--on-exceed', `node ${onExceedCaptureScript} ${outFile}`, '--json']);
  assert.equal(r.status, 2);

  const captured = JSON.parse(await readFile(outFile, 'utf8'));
  assert.equal(captured.trigger, 'stagnation');
  assert.equal(captured.escalate, true);
});

test('cli --on-exceed is not invoked when the run continues', async () => {
  const dir = await freshDir();
  const outFile = path.join(dir, 'should-not-exist.json');

  const r = runCli(
    ['--check', '--on-exceed', `node ${onExceedCaptureScript} ${outFile}`, '--json'],
    cheapLedger,
  );
  assert.equal(r.status, 0);
  await assert.rejects(() => readFile(outFile, 'utf8'));
});

const resumeLedger = {
  goal: 'ship continuity',
  attempts: [],
  handoff: {
    schema: 1,
    state: 'running',
    brief: 'Continue the bounded implementation.',
    nextStep: 'Run targeted tests.',
    focusPaths: ['tools/loop-context/src/handoff.ts'],
    proof: ['Source implementation is present.'],
    needs: [],
    turnsLeft: 2,
  },
};

test('cli --resume prints a valid handoff and does not mutate its ledger file', async () => {
  const dir = await freshDir();
  const ledgerPath = path.join(dir, 'ledger.json');
  const original = `${JSON.stringify(resumeLedger, null, 2)}\n`;
  try {
    await writeFile(ledgerPath, original);
    const r = runCli(['--resume', '--ledger', ledgerPath], '');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /# Loop Handoff/);
    assert.match(r.stdout, /Goal: ship continuity/);
    assert.match(r.stdout, /Current repository files, diffs, and tests are authoritative/);
    assert.equal(await readFile(ledgerPath, 'utf8'), original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli --resume --json emits the structured canonical view', () => {
  const r = runCli(['--resume', '--json'], JSON.stringify(resumeLedger));
  assert.equal(r.status, 0, r.stderr);
  const view = JSON.parse(r.stdout);
  assert.equal(view.goal, resumeLedger.goal);
  assert.equal(view.handoff.schema, 1);
  assert.equal(view.handoff.state, 'running');
  assert.match(view.authority, /Current repository files/);
});

test('cli --resume fails actionably when handoff is missing or invalid', () => {
  const missing = runCli(['--resume'], JSON.stringify({ goal: 'x', attempts: [] }));
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /handoff is missing.*schema 1.*--resume/);

  const invalid = runCli(
    ['--resume'],
    JSON.stringify({ ...resumeLedger, handoff: { ...resumeLedger.handoff, focusPaths: ['../outside'] } }),
  );
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /normalized project-relative path/);
});
