import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  createTaskLedger,
  normalizeProjectPath,
  readTaskLedger,
  validateTaskLedger,
  writeTaskLedger,
} from '../dist/task-state.js';

async function freshState(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-task-state-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'nested', 'task.json');
}

test('writeTaskLedger creates parent directories and persists canonical state', async (t) => {
  const statePath = await freshState(t);
  await writeTaskLedger(statePath, createTaskLedger('Ship the tested workflow', '2026-01-01T00:00:00.000Z'));

  const restored = await readTaskLedger(statePath);
  assert.equal(restored.goal, 'Ship the tested workflow');
  assert.equal(restored.task.phase, 'task');
  assert.equal(restored.handoff.state, 'running');
});

test('normalizeProjectPath accepts a normalized project-relative path', () => {
  assert.equal(normalizeProjectPath('tools\\loop-context\\src\\cli.ts'), 'tools/loop-context/src/cli.ts');
});

test('normalizeProjectPath rejects paths that escape the project', () => {
  assert.throws(() => normalizeProjectPath('../outside.txt'), /normalized project-relative path/);
});

test('validateTaskLedger rejects unsupported durable-state fields', () => {
  const ledger = createTaskLedger('Reject unknown state', '2026-01-01T00:00:00.000Z');
  ledger.task.untrusted = true;
  assert.throws(() => validateTaskLedger(ledger), /unsupported field: untrusted/);
});

test('readTaskLedger rejects an oversized state file before parsing it', async (t) => {
  const statePath = await freshState(t);
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, 'x'.repeat(256_001));
  await assert.rejects(() => readTaskLedger(statePath), /exceeds 256000 characters/);
});

test('writeTaskLedger leaves complete parseable JSON', async (t) => {
  const statePath = await freshState(t);
  await writeTaskLedger(statePath, createTaskLedger('Persist atomically', '2026-01-01T00:00:00.000Z'));
  const persisted = await readFile(statePath, 'utf8');
  assert.doesNotThrow(() => JSON.parse(persisted));
});
