import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
export async function fileExists(p) {
    try {
        await access(p);
        return true;
    }
    catch {
        return false;
    }
}
export async function readText(p) {
    try {
        return await readFile(p, 'utf8');
    }
    catch {
        return null;
    }
}
const STATE_CANDIDATES = [
    'STATE.md',
    'pr-babysitter-state.md',
    'ci-sweeper-state.md',
    'post-merge-state.md',
    'dependency-sweeper-state.md',
    'changelog-drafter-state.md',
    'issue-triage-state.md',
];
export async function findStateFile(root) {
    for (const name of STATE_CANDIDATES) {
        const p = path.join(root, name);
        if (await fileExists(p))
            return name;
    }
    return null;
}
/** Parse JSONL-ish entries from loop-run-log.md (lines that look like JSON objects). */
export function parseRunLog(content, limit = 5) {
    const entries = [];
    for (const line of content.split('\n')) {
        const t = line.trim();
        if (!t.startsWith('{') || !t.endsWith('}'))
            continue;
        try {
            entries.push(JSON.parse(t));
        }
        catch {
            /* skip malformed */
        }
    }
    return entries.slice(-limit).reverse();
}
export function extractLastRun(stateContent) {
    if (!stateContent)
        return null;
    const m = stateContent.match(/Last run:\s*(.+)/i);
    return m ? m[1].trim() : null;
}
export function extractPatternsFromLoop(loopContent) {
    if (!loopContent)
        return [];
    const patterns = new Set();
    const known = [
        'daily-triage',
        'pr-babysitter',
        'ci-sweeper',
        'dependency-sweeper',
        'post-merge-cleanup',
        'changelog-drafter',
        'issue-triage',
    ];
    for (const p of known) {
        if (loopContent.toLowerCase().includes(p.replace(/-/g, ' ')) || loopContent.includes(p)) {
            patterns.add(p);
        }
    }
    // ### Daily Triage headers
    const headerRe = /^###\s+([A-Za-z][A-Za-z0-9 /&-]+)/gm;
    let m;
    while ((m = headerRe.exec(loopContent)) !== null) {
        const slug = m[1]
            .toLowerCase()
            .replace(/\(.*\)/g, '')
            .trim()
            .replace(/\s+/g, '-');
        if (known.includes(slug))
            patterns.add(slug);
    }
    return [...patterns];
}
export function budgetPresent(content) {
    return Boolean(content && /max tokens|daily limits|kill switch/i.test(content));
}
export function parseLedger(raw) {
    if (!raw)
        return { present: false };
    try {
        const j = JSON.parse(raw);
        return {
            present: true,
            pattern: j.pattern,
            level: j.level,
            attempts: Array.isArray(j.attempts) ? j.attempts.length : undefined,
            open: typeof j.open === 'boolean' ? j.open : j.status === 'open',
        };
    }
    catch {
        return { present: true };
    }
}
