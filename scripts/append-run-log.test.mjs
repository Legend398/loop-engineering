#!/usr/bin/env node
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const CLI = path.resolve('scripts/append-run-log.mjs');
const MARKER = '<!-- Loop appends below this line -->';

async function freshLog() {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-run-log-'));
  const log = path.join(dir, 'loop-run-log.md');
  await writeFile(log, `# Run log\n\n${MARKER}\n`);
  return { dir, log };
}

function parseEntries(content) {
  return content
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line));
}

test('invalid JSON exits with a usage message', async () => {
  await assert.rejects(
    exec(process.execPath, [CLI, 'not-json', 'ignored.log']),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(`${error.stderr}${error.stdout}`, /Usage|valid JSON/i);
      return true;
    },
  );
});

test('replaying the same run id replaces its entry instead of duplicating it', async () => {
  const { dir, log } = await freshLog();
  const runId = new Date().toISOString();
  try {
    await exec(process.execPath, [CLI, JSON.stringify({ run_id: runId, outcome: 'started' }), log]);
    await exec(process.execPath, [CLI, JSON.stringify({ run_id: runId, outcome: 'passed' }), log]);
    const entries = parseEntries(await readFile(log, 'utf8'));
    assert.deepEqual(entries, [{ run_id: runId, outcome: 'passed' }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('concurrent distinct runs are serialized without lost entries or lock debris', async () => {
  const { dir, log } = await freshLog();
  const baseTime = Date.now();
  const entries = Array.from({ length: 12 }, (_, index) => ({
    run_id: new Date(baseTime - index).toISOString(),
    outcome: 'passed',
  }));
  assert.equal(new Set(entries.map((entry) => entry.run_id)).size, entries.length);
  try {
    await Promise.all(entries.map((entry) => exec(process.execPath, [CLI, JSON.stringify(entry), log])));
    const written = parseEntries(await readFile(log, 'utf8'));
    assert.equal(written.length, entries.length);
    assert.deepEqual(new Set(written.map((entry) => entry.run_id)), new Set(entries.map((entry) => entry.run_id)));
    assert.deepEqual(
      (await readdir(dir)).filter((name) => name.includes('.tmp-') || name.endsWith('.lock')),
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('invalid entries fail without changing the log', async () => {
  const { dir, log } = await freshLog();
  const before = await readFile(log, 'utf8');
  try {
    await assert.rejects(
      () => exec(process.execPath, [CLI, JSON.stringify({ outcome: 'passed' }), log]),
      /date-like run_id/,
    );
    assert.equal(await readFile(log, 'utf8'), before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
