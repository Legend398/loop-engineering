import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
const PATTERN_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const EVENT_ID_MAX_CHARS = 128;
const MAX_DAILY_EVENTS = 4096;
const LOCK_RETRY_MS = 25;
const LOCK_ATTEMPTS = 200;
const WINDOWS_TRANSIENT_CODES = new Set(['EACCES', 'EBUSY', 'ENOTEMPTY', 'EPERM']);
/** Today's date in UTC, as YYYY-MM-DD — the daily-spend rollover boundary. */
export function todayUTC() {
    return new Date().toISOString().slice(0, 10);
}
function statePath(dir, pattern) {
    if (!PATTERN_SLUG.test(pattern)) {
        throw new Error(`Invalid daily-spend pattern "${pattern}": expected a lowercase slug.`);
    }
    return path.join(dir, `daily-spend.${pattern}.json`);
}
async function readState(dir, pattern) {
    try {
        const raw = await readFile(statePath(dir, pattern), 'utf8');
        const parsed = JSON.parse(raw);
        if (typeof parsed.date !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ||
            !Number.isSafeInteger(parsed.tokensUsedToday) ||
            parsed.tokensUsedToday < 0 ||
            (parsed.eventIds !== undefined && (!Array.isArray(parsed.eventIds) ||
                parsed.eventIds.length > MAX_DAILY_EVENTS ||
                parsed.eventIds.some((id) => typeof id !== 'string' || id.length === 0 || id.length > EVENT_ID_MAX_CHARS)))) {
            throw new Error('expected { date, non-negative tokensUsedToday, eventIds? }.');
        }
        return {
            date: parsed.date,
            tokensUsedToday: parsed.tokensUsedToday,
            eventIds: parsed.eventIds ?? [],
        };
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return null;
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid daily-spend state for pattern "${pattern}": ${detail}`);
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function isRetryableWindowsError(error) {
    const code = error.code;
    return process.platform === 'win32' && code !== undefined && WINDOWS_TRANSIENT_CODES.has(code);
}
async function releaseLock(lock) {
    for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
        try {
            await rmdir(lock);
            return;
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return;
            if (!isRetryableWindowsError(error))
                throw error;
            await sleep(LOCK_RETRY_MS);
        }
    }
    throw new Error(`Timed out releasing daily-spend lock: ${lock}.`);
}
async function acquireLock(file) {
    const lock = `${file}.lock`;
    for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
        try {
            await mkdir(lock);
            return () => releaseLock(lock);
        }
        catch (error) {
            if (error.code !== 'EEXIST' && !isRetryableWindowsError(error))
                throw error;
            await sleep(LOCK_RETRY_MS);
        }
    }
    throw new Error(`Timed out waiting for daily-spend lock: ${lock}. Confirm no writer is active before removing it.`);
}
async function writeStateAtomic(file, state) {
    const temp = `${file}.tmp-${process.pid}-${randomUUID()}`;
    try {
        await writeFile(temp, JSON.stringify(state, null, 2));
        for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
            try {
                await rename(temp, file);
                return;
            }
            catch (error) {
                if (!isRetryableWindowsError(error))
                    throw error;
                await sleep(LOCK_RETRY_MS);
            }
        }
        throw new Error(`Timed out replacing daily-spend state: ${file}.`);
    }
    finally {
        await rm(temp, { force: true });
    }
}
/**
 * Add `tokensDelta` to a pattern's running daily total and persist it. Rolls
 * over to a fresh total when the stored date isn't today (UTC) — a stale
 * file from a previous day is treated as if it didn't exist.
 */
export async function recordDailySpend(dir, pattern, tokensDelta, eventId) {
    if (!Number.isSafeInteger(tokensDelta) || tokensDelta < 0) {
        throw new Error('Daily-spend token delta must be a non-negative safe integer.');
    }
    if (eventId !== undefined &&
        (typeof eventId !== 'string' || eventId.length === 0 || eventId.length > EVENT_ID_MAX_CHARS)) {
        throw new Error(`Daily-spend event id must contain 1-${EVENT_ID_MAX_CHARS} characters.`);
    }
    await mkdir(dir, { recursive: true });
    const file = statePath(dir, pattern);
    const release = await acquireLock(file);
    try {
        const today = todayUTC();
        const existing = await readState(dir, pattern);
        const current = existing?.date === today
            ? existing
            : { date: today, tokensUsedToday: 0, eventIds: [] };
        if (eventId !== undefined && current.eventIds.includes(eventId))
            return current;
        if (eventId !== undefined && current.eventIds.length >= MAX_DAILY_EVENTS) {
            throw new Error(`Daily-spend state reached its ${MAX_DAILY_EVENTS}-event safety bound.`);
        }
        const tokensUsedToday = current.tokensUsedToday + tokensDelta;
        if (!Number.isSafeInteger(tokensUsedToday)) {
            throw new Error('Daily-spend total exceeded the safe integer range.');
        }
        const state = {
            date: today,
            tokensUsedToday,
            eventIds: eventId === undefined ? current.eventIds : [...current.eventIds, eventId],
        };
        await writeStateAtomic(file, state);
        return state;
    }
    finally {
        await release();
    }
}
