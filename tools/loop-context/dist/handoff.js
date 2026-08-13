import path from 'node:path';
export const HANDOFF_SCHEMA = 1;
export const HANDOFF_LIMITS = Object.freeze({
    goalChars: 500,
    briefChars: 500,
    nextStepChars: 500,
    pathChars: 160,
    itemChars: 240,
    focusPaths: 8,
    proofItems: 6,
    needItems: 6,
    turns: 100,
    outputLines: 64,
    outputChars: 6000,
});
export const HANDOFF_AUTHORITY_NOTICE = 'Current repository files, diffs, and tests are authoritative over this saved handoff.';
const HANDOFF_FIELDS = new Set([
    'schema',
    'state',
    'brief',
    'nextStep',
    'focusPaths',
    'proof',
    'needs',
    'turnsLeft',
]);
function invalid(detail) {
    throw new Error(`Invalid ledger handoff: ${detail}`);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function boundedText(value, field, maxChars) {
    if (typeof value !== 'string')
        invalid(`${field} must be a string.`);
    const normalized = value.trim();
    if (!normalized)
        invalid(`${field} must not be empty.`);
    if (value.length > maxChars)
        invalid(`${field} must be at most ${maxChars} characters.`);
    return normalized;
}
function boundedList(value, field, maxItems) {
    if (!Array.isArray(value))
        invalid(`${field} must be an array.`);
    if (value.length > maxItems)
        invalid(`${field} must contain at most ${maxItems} items.`);
    return value.map((item, index) => boundedText(item, `${field}[${index}]`, HANDOFF_LIMITS.itemChars));
}
function projectRelativePath(value, index) {
    const field = `handoff.focusPaths[${index}]`;
    const candidate = boundedText(value, field, HANDOFF_LIMITS.pathChars);
    if (candidate.includes('\\'))
        invalid(`${field} must use forward slashes, not backslashes.`);
    if (candidate.startsWith('/') ||
        candidate.startsWith('~') ||
        /^[A-Za-z]:/.test(candidate) ||
        path.posix.normalize(candidate) !== candidate ||
        candidate.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
        invalid(`${field} must be a normalized project-relative path without absolute or traversal segments.`);
    }
    return candidate;
}
/** Validate and return a canonical copy of the optional ledger handoff record. */
export function validateHandoff(value) {
    if (value === undefined) {
        invalid('handoff is missing. Add a schema 1 handoff object before using --resume.');
    }
    if (!isRecord(value))
        invalid('handoff must be an object.');
    const unknownFields = Object.keys(value).filter((field) => !HANDOFF_FIELDS.has(field)).sort();
    if (unknownFields.length > 0)
        invalid(`unsupported field${unknownFields.length === 1 ? '' : 's'}: ${unknownFields.join(', ')}.`);
    if (value.schema !== HANDOFF_SCHEMA)
        invalid(`handoff.schema must be ${HANDOFF_SCHEMA}.`);
    if (value.state !== 'running' && value.state !== 'waiting' && value.state !== 'finished') {
        invalid('handoff.state must be "running", "waiting", or "finished".');
    }
    const state = value.state;
    const brief = boundedText(value.brief, 'handoff.brief', HANDOFF_LIMITS.briefChars);
    const nextStep = value.nextStep === undefined
        ? undefined
        : boundedText(value.nextStep, 'handoff.nextStep', HANDOFF_LIMITS.nextStepChars);
    if (!Array.isArray(value.focusPaths))
        invalid('handoff.focusPaths must be an array.');
    if (value.focusPaths.length > HANDOFF_LIMITS.focusPaths) {
        invalid(`handoff.focusPaths must contain at most ${HANDOFF_LIMITS.focusPaths} items.`);
    }
    const focusPaths = value.focusPaths.map(projectRelativePath);
    const proof = boundedList(value.proof, 'handoff.proof', HANDOFF_LIMITS.proofItems);
    const needs = boundedList(value.needs, 'handoff.needs', HANDOFF_LIMITS.needItems);
    if (!Number.isInteger(value.turnsLeft) || value.turnsLeft < 0 || value.turnsLeft > HANDOFF_LIMITS.turns) {
        invalid(`handoff.turnsLeft must be an integer from 0 to ${HANDOFF_LIMITS.turns}.`);
    }
    const turnsLeft = value.turnsLeft;
    if (state === 'running' && nextStep === undefined) {
        invalid('handoff.nextStep is required when state is "running".');
    }
    if (state === 'running' && turnsLeft === 0) {
        invalid('handoff.turnsLeft must be positive when state is "running".');
    }
    if (state === 'waiting' && needs.length === 0) {
        invalid('handoff.needs must contain at least one blocker when state is "waiting".');
    }
    if (state === 'finished' && nextStep !== undefined) {
        invalid('handoff.nextStep must be omitted when state is "finished".');
    }
    if (state === 'finished' && turnsLeft !== 0) {
        invalid('handoff.turnsLeft must be 0 when state is "finished".');
    }
    return { schema: HANDOFF_SCHEMA, state, brief, ...(nextStep ? { nextStep } : {}), focusPaths, proof, needs, turnsLeft };
}
function validateGoal(value) {
    return boundedText(value, 'ledger.goal', HANDOFF_LIMITS.goalChars);
}
function oneLine(value) {
    return value.replace(/\s+/g, ' ').trim();
}
function addList(lines, label, items) {
    lines.push(`${label}:`);
    if (items.length === 0)
        lines.push('- (none)');
    else
        for (const item of items)
            lines.push(`- ${oneLine(item)}`);
}
/** Render a validated, deterministic, prompt-bounded continuity handoff. */
export function renderHandoff(value, goalValue) {
    const handoff = validateHandoff(value);
    const goal = validateGoal(goalValue);
    const lines = [
        '# Loop Handoff',
        '',
        `Goal: ${oneLine(goal)}`,
        `State: ${handoff.state}`,
        `Brief: ${oneLine(handoff.brief)}`,
        `Turns left: ${handoff.turnsLeft}`,
    ];
    if (handoff.nextStep)
        lines.push(`Next step: ${oneLine(handoff.nextStep)}`);
    lines.push('', `Authority: ${HANDOFF_AUTHORITY_NOTICE}`, '');
    addList(lines, 'Focus paths', handoff.focusPaths);
    lines.push('');
    addList(lines, 'Proof', handoff.proof);
    lines.push('');
    addList(lines, 'Needs', handoff.needs);
    const output = lines.join('\n');
    if (lines.length > HANDOFF_LIMITS.outputLines || output.length > HANDOFF_LIMITS.outputChars) {
        throw new Error('Validated ledger handoff exceeded the bounded resume output; shorten its fields.');
    }
    return output;
}
export function buildResumeView(value, goalValue) {
    return {
        goal: validateGoal(goalValue),
        handoff: validateHandoff(value),
        authority: HANDOFF_AUTHORITY_NOTICE,
    };
}
/** Render the structured resume view under the same hard output bounds as text mode. */
export function renderResumeJson(value, goalValue) {
    const output = JSON.stringify(buildResumeView(value, goalValue), null, 2);
    if (output.split('\n').length > HANDOFF_LIMITS.outputLines ||
        output.length > HANDOFF_LIMITS.outputChars) {
        throw new Error('Validated ledger handoff exceeded the bounded JSON resume output; shorten its fields.');
    }
    return output;
}
