import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { recordDailySpend, todayUTC } from '../dist/daily-spend.js';

async function freshDir() {
  return mkdtemp(path.join(tmpdir(), 'loop-context-daily-spend-'));
}

test('recordDailySpend starts a fresh total when no state file exists', async () => {
  const dir = await freshDir();
  const state = await recordDailySpend(dir, 'ci-sweeper', 1200);
  assert.equal(state.date, todayUTC());
  assert.equal(state.tokensUsedToday, 1200);
});

test('recordDailySpend accumulates across repeated calls on the same day', async () => {
  const dir = await freshDir();
  await recordDailySpend(dir, 'ci-sweeper', 1000);
  await recordDailySpend(dir, 'ci-sweeper', 500);
  const state = await recordDailySpend(dir, 'ci-sweeper', 250);
  assert.equal(state.tokensUsedToday, 1750);
});

test('recordDailySpend tracks separate patterns independently', async () => {
  const dir = await freshDir();
  await recordDailySpend(dir, 'ci-sweeper', 1000);
  const other = await recordDailySpend(dir, 'dependency-sweeper', 300);
  assert.equal(other.tokensUsedToday, 300);
});

test('recordDailySpend rolls over a stale date instead of carrying its total forward', async () => {
  const dir = await freshDir();
  await writeFile(
    path.join(dir, 'daily-spend.ci-sweeper.json'),
    JSON.stringify({ date: '2000-01-01', tokensUsedToday: 999999 }),
  );
  const state = await recordDailySpend(dir, 'ci-sweeper', 400);
  assert.equal(state.date, todayUTC());
  assert.equal(state.tokensUsedToday, 400);
});

test('recordDailySpend persists the state to disk', async () => {
  const dir = await freshDir();
  await recordDailySpend(dir, 'ci-sweeper', 700);
  const raw = await readFile(path.join(dir, 'daily-spend.ci-sweeper.json'), 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.tokensUsedToday, 700);
});

test('recordDailySpend counts a stable event id at most once', async () => {
  const dir = await freshDir();
  await recordDailySpend(dir, 'ci-sweeper', 500, 'run-1-attempt-1');
  const repeated = await recordDailySpend(dir, 'ci-sweeper', 500, 'run-1-attempt-1');
  assert.equal(repeated.tokensUsedToday, 500);
  assert.deepEqual(repeated.eventIds, ['run-1-attempt-1']);
});

test('recordDailySpend serializes concurrent distinct events without losing updates', async () => {
  const dir = await freshDir();
  const count = 24;
  await Promise.all(Array.from({ length: count }, (_, i) =>
    recordDailySpend(dir, 'ci-sweeper', 10, `run-1-attempt-${i}`)));
  const state = await recordDailySpend(dir, 'ci-sweeper', 0, 'read-final-state');
  assert.equal(state.tokensUsedToday, count * 10);
  assert.equal(new Set(state.eventIds).size, count + 1);
  assert.deepEqual((await readdir(dir)).filter((name) => name.includes('.tmp-') || name.endsWith('.lock')), []);
});

test('recordDailySpend accepts legacy state and rejects corrupt state', async () => {
  const dir = await freshDir();
  const file = path.join(dir, 'daily-spend.ci-sweeper.json');
  await writeFile(file, JSON.stringify({ date: todayUTC(), tokensUsedToday: 100 }));
  const migrated = await recordDailySpend(dir, 'ci-sweeper', 50, 'migration-event');
  assert.equal(migrated.tokensUsedToday, 150);
  assert.deepEqual(migrated.eventIds, ['migration-event']);

  await writeFile(file, '{not-json');
  await assert.rejects(
    () => recordDailySpend(dir, 'ci-sweeper', 50, 'after-corruption'),
    /Invalid daily-spend state/,
  );
});

test('recordDailySpend rejects unsafe inputs', async () => {
  const dir = await freshDir();
  await assert.rejects(() => recordDailySpend(dir, '../outside', 1, 'event'), /expected a lowercase slug/);
  await assert.rejects(() => recordDailySpend(dir, 'ci-sweeper', -1, 'event'), /non-negative safe integer/);
  await assert.rejects(() => recordDailySpend(dir, 'ci-sweeper', 1, ''), /event id must contain/);
  await assert.rejects(() => recordDailySpend(dir, 'ci-sweeper', 1, 42), /event id must contain/);
});
