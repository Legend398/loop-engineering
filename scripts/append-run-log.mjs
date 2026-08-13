#!/usr/bin/env node
/**
 * Append one JSON run entry to loop-run-log.md and prune entries older than 30 days.
 * Usage: node scripts/append-run-log.mjs '<json-object>' [path-to-log]
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';

const MARKER = '<!-- Loop appends below this line -->';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const LOCK_RETRY_MS = 25;
const LOCK_ATTEMPTS = 200;
const WINDOWS_TRANSIENT_CODES = new Set(['EACCES', 'EBUSY', 'ENOTEMPTY', 'EPERM']);

const entryJson = process.argv[2];
const logPath = process.argv[3] || 'loop-run-log.md';

if (!entryJson) {
  console.error('Usage: node scripts/append-run-log.mjs \'<json>\' [loop-run-log.md]');
  process.exit(1);
}

let entry;
try {
  entry = JSON.parse(entryJson);
} catch {
  console.error('Usage: second argument must be a valid JSON object');
  process.exit(1);
}
if (
  typeof entry !== 'object' ||
  entry === null ||
  Array.isArray(entry) ||
  typeof entry.run_id !== 'string' ||
  Number.isNaN(new Date(entry.run_id).getTime())
) {
  console.error('Usage: JSON entry must be an object with a date-like run_id string');
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableWindowsError(error) {
  return process.platform === 'win32' && WINDOWS_TRANSIENT_CODES.has(error?.code);
}

async function releaseLock(lock) {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      await rmdir(lock);
      return;
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      if (!isRetryableWindowsError(error)) throw error;
      await sleep(LOCK_RETRY_MS);
    }
  }
  throw new Error(`Timed out releasing run-log lock: ${lock}.`);
}

async function acquireLock(file) {
  const lock = `${file}.lock`;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      await mkdir(lock);
      return () => releaseLock(lock);
    } catch (error) {
      if (error?.code !== 'EEXIST' && !isRetryableWindowsError(error)) throw error;
      await sleep(LOCK_RETRY_MS);
    }
  }
  throw new Error(`Timed out waiting for run-log lock: ${lock}. Confirm no writer is active before removing it.`);
}

async function writeAtomic(file, content) {
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temp, content);
    for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
      try {
        await rename(temp, file);
        return;
      } catch (error) {
        if (!isRetryableWindowsError(error)) throw error;
        await sleep(LOCK_RETRY_MS);
      }
    }
    throw new Error(`Timed out replacing run log: ${file}.`);
  } finally {
    await rm(temp, { force: true });
  }
}

const resolvedLogPath = path.resolve(logPath);
const release = await acquireLock(resolvedLogPath);
try {
  const content = await readFile(resolvedLogPath, 'utf8');
  const markerAt = content.indexOf(MARKER);
  if (markerAt === -1) throw new Error(`Marker not found in ${logPath}`);

  const before = content.slice(0, markerAt + MARKER.length);
  const after = content.slice(markerAt + MARKER.length);
  const now = Date.now();
  const kept = [];

  for (const line of after.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const existing = JSON.parse(trimmed);
      const timestamp = new Date(existing.run_id).getTime();
      if (
        !Number.isNaN(timestamp) &&
        now - timestamp <= MAX_AGE_MS &&
        existing.run_id !== entry.run_id
      ) {
        kept.push(trimmed);
      }
    } catch {
      // Ignore malformed historical JSON lines; headings and comments stay above the marker.
    }
  }

  kept.push(JSON.stringify(entry));
  await writeAtomic(resolvedLogPath, `${before}\n\n${kept.join('\n')}\n`);
  console.log(`Recorded run ${entry.run_id} (${kept.length} unique entries within 30d window)`);
} finally {
  await release();
}
