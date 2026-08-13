import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkCircuitBreaker, DEFAULT_BREAKER, } from './context-manager.js';
import { HANDOFF_LIMITS, HANDOFF_SCHEMA, validateHandoff, } from './handoff.js';
export const DEFAULT_TASK_STATE = '.loop/task.json';
export const TASK_SCHEMA = 1;
export const TASK_LIMITS = Object.freeze({
    textChars: 500,
    eventChars: 240,
    planItems: 8,
    fileItems: 16,
    events: 20,
    attempts: 10,
    argvItems: 32,
    argvChars: 1000,
    outputChars: 4000,
    outputLines: 40,
    statusChars: 12000,
});
const TASK_FIELDS = new Set([
    'schema', 'objective', 'phase', 'status', 'iteration', 'plan', 'files',
    'implementation', 'verification', 'checker', 'result', 'blocker', 'updatedAt', 'events',
]);
const EVENT_FIELDS = new Set(['at', 'phase', 'status', 'message']);
const IMPLEMENTATION_FIELDS = new Set(['iteration', 'summary', 'recordedAt']);
const VERIFICATION_FIELDS = new Set(['iteration', 'command', 'status', 'exitCode', 'outputTail', 'workspaceFingerprint', 'recordedAt']);
const CHECKER_FIELDS = new Set(['iteration', 'label', 'status', 'evidence', 'recordedAt']);
const PHASES = new Set(['task', 'plan', 'implement', 'verify', 'checker', 'finish']);
const STATUSES = new Set(['active', 'blocked', 'completed', 'cancelled']);
function invalid(detail) {
    throw new Error(`Invalid task state: ${detail}`);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function strictRecord(value, field, allowed) {
    if (!isRecord(value))
        invalid(`${field} must be an object.`);
    const unknown = Object.keys(value).filter((key) => !allowed.has(key)).sort();
    if (unknown.length)
        invalid(`${field} has unsupported field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`);
    return value;
}
export function boundedTaskText(value, field, max = TASK_LIMITS.textChars) {
    if (typeof value !== 'string')
        invalid(`${field} must be a string.`);
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized)
        invalid(`${field} must not be empty.`);
    if (normalized.length > max)
        invalid(`${field} must be at most ${max} characters.`);
    return normalized;
}
function boundedOptionalText(value, field) {
    return value === undefined ? undefined : boundedTaskText(value, field);
}
function isoDate(value, field) {
    if (typeof value !== 'string' || value.length > 128 || Number.isNaN(Date.parse(value))) {
        invalid(`${field} must be a date-like string.`);
    }
    return value;
}
function positiveIteration(value, field, allowZero = false) {
    if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
        invalid(`${field} must be ${allowZero ? 'a non-negative' : 'a positive'} integer.`);
    }
    return value;
}
function phase(value, field) {
    if (typeof value !== 'string' || !PHASES.has(value))
        invalid(`${field} is invalid.`);
    return value;
}
function status(value, field) {
    if (typeof value !== 'string' || !STATUSES.has(value))
        invalid(`${field} is invalid.`);
    return value;
}
function evidenceStatus(value, field) {
    if (value !== 'pass' && value !== 'fail')
        invalid(`${field} must be "pass" or "fail".`);
    return value;
}
function boundedStrings(value, field, maxItems, maxChars = TASK_LIMITS.textChars) {
    if (!Array.isArray(value) || value.length > maxItems)
        invalid(`${field} must be an array of at most ${maxItems} items.`);
    return value.map((item, index) => boundedTaskText(item, `${field}[${index}]`, maxChars));
}
export function validateArgv(value, field = 'argv') {
    if (!Array.isArray(value) || value.length === 0 || value.length > TASK_LIMITS.argvItems) {
        invalid(`${field} must be a non-empty array of at most ${TASK_LIMITS.argvItems} items.`);
    }
    return value.map((item, index) => {
        if (typeof item !== 'string')
            invalid(`${field}[${index}] must be a string.`);
        if (item.includes('\0'))
            invalid(`${field}[${index}] must not contain NUL.`);
        if (item.length > TASK_LIMITS.argvChars)
            invalid(`${field}[${index}] must be at most ${TASK_LIMITS.argvChars} characters.`);
        if (index === 0 && item.length === 0)
            invalid(`${field}[0] executable must not be empty.`);
        return item;
    });
}
export function normalizeProjectPath(value, field = '--file') {
    const candidate = boundedTaskText(value, field, HANDOFF_LIMITS.pathChars).replace(/\\/g, '/');
    const normalized = path.posix.normalize(candidate).replace(/^\.\//, '');
    if (normalized === '.' || normalized.startsWith('/') || normalized.startsWith('../') ||
        normalized.includes('/../') || normalized.startsWith('~') || /^[A-Za-z]:/.test(normalized) ||
        normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
        invalid(`${field} must be a normalized project-relative path.`);
    }
    return normalized;
}
function validateEvent(value, index) {
    const event = strictRecord(value, `task.events[${index}]`, EVENT_FIELDS);
    return {
        at: isoDate(event.at, `task.events[${index}].at`),
        phase: phase(event.phase, `task.events[${index}].phase`),
        status: status(event.status, `task.events[${index}].status`),
        message: boundedTaskText(event.message, `task.events[${index}].message`, TASK_LIMITS.eventChars),
    };
}
function validateImplementation(value) {
    if (value === undefined)
        return undefined;
    const item = strictRecord(value, 'task.implementation', IMPLEMENTATION_FIELDS);
    return {
        iteration: positiveIteration(item.iteration, 'task.implementation.iteration'),
        summary: boundedTaskText(item.summary, 'task.implementation.summary'),
        recordedAt: isoDate(item.recordedAt, 'task.implementation.recordedAt'),
    };
}
function validateVerification(value) {
    if (value === undefined)
        return undefined;
    const item = strictRecord(value, 'task.verification', VERIFICATION_FIELDS);
    const command = validateArgv(item.command, 'task.verification.command');
    if (item.exitCode !== null && (!Number.isSafeInteger(item.exitCode) || item.exitCode < 0)) {
        invalid('task.verification.exitCode must be null or a non-negative integer.');
    }
    if (typeof item.outputTail !== 'string' || item.outputTail.length > TASK_LIMITS.outputChars) {
        invalid(`task.verification.outputTail must be a string of at most ${TASK_LIMITS.outputChars} characters.`);
    }
    if (item.workspaceFingerprint !== undefined && (typeof item.workspaceFingerprint !== 'string' ||
        !/^git-sha256:[a-f0-9]{64}$/.test(item.workspaceFingerprint))) {
        invalid('task.verification.workspaceFingerprint must be a bounded Git SHA-256 fingerprint.');
    }
    return {
        iteration: positiveIteration(item.iteration, 'task.verification.iteration'),
        command,
        status: evidenceStatus(item.status, 'task.verification.status'),
        exitCode: item.exitCode,
        outputTail: item.outputTail,
        ...(item.workspaceFingerprint !== undefined ? { workspaceFingerprint: item.workspaceFingerprint } : {}),
        recordedAt: isoDate(item.recordedAt, 'task.verification.recordedAt'),
    };
}
function validateChecker(value) {
    if (value === undefined)
        return undefined;
    const item = strictRecord(value, 'task.checker', CHECKER_FIELDS);
    return {
        iteration: positiveIteration(item.iteration, 'task.checker.iteration'),
        label: boundedTaskText(item.label, 'task.checker.label', 160),
        status: evidenceStatus(item.status, 'task.checker.status'),
        evidence: boundedTaskText(item.evidence, 'task.checker.evidence'),
        recordedAt: isoDate(item.recordedAt, 'task.checker.recordedAt'),
    };
}
function validateAttempt(value, index) {
    if (!isRecord(value))
        invalid(`attempts[${index}] must be an object.`);
    const outcome = value.outcome;
    if (outcome !== 'success' && outcome !== 'failure' && outcome !== 'noop')
        invalid(`attempts[${index}].outcome is invalid.`);
    const result = {
        iteration: positiveIteration(value.iteration, `attempts[${index}].iteration`),
        action: boundedTaskText(value.action, `attempts[${index}].action`),
        outcome,
    };
    if (value.timestamp !== undefined)
        result.timestamp = isoDate(value.timestamp, `attempts[${index}].timestamp`);
    if (value.error !== undefined)
        result.error = boundedTaskText(value.error, `attempts[${index}].error`, TASK_LIMITS.outputChars);
    if (value.tokensUsed !== undefined) {
        if (!Number.isSafeInteger(value.tokensUsed) || value.tokensUsed < 0)
            invalid(`attempts[${index}].tokensUsed is invalid.`);
        result.tokensUsed = value.tokensUsed;
    }
    return result;
}
export function validateTaskLedger(value) {
    if (!isRecord(value))
        invalid('root must be an object.');
    const goal = boundedTaskText(value.goal, 'goal');
    const startedAt = isoDate(value.startedAt, 'startedAt');
    if (!Array.isArray(value.attempts) || value.attempts.length > TASK_LIMITS.attempts) {
        invalid(`attempts must be an array of at most ${TASK_LIMITS.attempts} items.`);
    }
    const taskValue = strictRecord(value.task, 'task', TASK_FIELDS);
    if (taskValue.schema !== TASK_SCHEMA)
        invalid(`task.schema must be ${TASK_SCHEMA}.`);
    const taskPhase = phase(taskValue.phase, 'task.phase');
    const taskStatus = status(taskValue.status, 'task.status');
    const iteration = positiveIteration(taskValue.iteration, 'task.iteration', true);
    const files = boundedStrings(taskValue.files, 'task.files', TASK_LIMITS.fileItems, HANDOFF_LIMITS.pathChars)
        .map((file, index) => normalizeProjectPath(file, `task.files[${index}]`));
    if (!Array.isArray(taskValue.events) || taskValue.events.length > TASK_LIMITS.events) {
        invalid(`task.events must be an array of at most ${TASK_LIMITS.events} items.`);
    }
    const implementation = validateImplementation(taskValue.implementation);
    const verification = validateVerification(taskValue.verification);
    const checker = validateChecker(taskValue.checker);
    const result = boundedOptionalText(taskValue.result, 'task.result');
    const blocker = boundedOptionalText(taskValue.blocker, 'task.blocker');
    if (taskStatus === 'blocked' && !blocker)
        invalid('task.blocker is required when task.status is "blocked".');
    if ((taskStatus === 'completed' || taskStatus === 'cancelled') && taskPhase !== 'finish') {
        invalid('completed or cancelled tasks must be in phase "finish".');
    }
    if (taskStatus === 'completed' && !result)
        invalid('task.result is required when task.status is "completed".');
    if (goal !== boundedTaskText(taskValue.objective, 'task.objective'))
        invalid('goal and task.objective must match.');
    const handoff = validateHandoff(value.handoff);
    return {
        goal,
        startedAt,
        attempts: value.attempts.map(validateAttempt),
        handoff,
        task: {
            schema: TASK_SCHEMA,
            objective: goal,
            phase: taskPhase,
            status: taskStatus,
            iteration,
            plan: boundedStrings(taskValue.plan, 'task.plan', TASK_LIMITS.planItems),
            files,
            ...(implementation ? { implementation } : {}),
            ...(verification ? { verification } : {}),
            ...(checker ? { checker } : {}),
            ...(result ? { result } : {}),
            ...(blocker ? { blocker } : {}),
            updatedAt: isoDate(taskValue.updatedAt, 'task.updatedAt'),
            events: taskValue.events.map(validateEvent),
        },
    };
}
function nextStep(task) {
    switch (task.phase) {
        case 'task': return 'Record the implementation plan with loop task plan <step...>.';
        case 'plan': return 'Record the revised implementation plan with loop task plan <step...>.';
        case 'implement': return 'Implement the plan, then record it with loop task implemented <summary>.';
        case 'verify': return 'Run exact verification argv with loop task verify "--" <command> [args...].';
        case 'checker': return 'Record an independent checker verdict with loop task check pass|fail <evidence> --checker <label>.';
        case 'finish': return 'Complete the task with loop task finish <summary>.';
    }
}
export function refreshHandoff(ledger) {
    const task = ledger.task;
    let handoff;
    if (task.status === 'completed' || task.status === 'cancelled') {
        handoff = {
            schema: HANDOFF_SCHEMA,
            state: 'finished',
            brief: task.result ?? task.blocker ?? `${task.status}: ${task.objective}`,
            focusPaths: task.files.slice(-HANDOFF_LIMITS.focusPaths),
            proof: compactProof(task),
            needs: [],
            turnsLeft: 0,
        };
    }
    else if (task.status === 'blocked') {
        handoff = {
            schema: HANDOFF_SCHEMA,
            state: 'waiting',
            brief: `Blocked in ${task.phase}: ${task.objective}`.slice(0, HANDOFF_LIMITS.briefChars),
            focusPaths: task.files.slice(-HANDOFF_LIMITS.focusPaths),
            proof: compactProof(task),
            needs: [(task.blocker ?? 'Resolve the recorded blocker before continuing.').slice(0, HANDOFF_LIMITS.itemChars)],
            turnsLeft: 1,
        };
    }
    else {
        handoff = {
            schema: HANDOFF_SCHEMA,
            state: 'running',
            brief: `Task is ${task.status} in ${task.phase} (iteration ${task.iteration}): ${task.objective}`.slice(0, HANDOFF_LIMITS.briefChars),
            nextStep: nextStep(task),
            focusPaths: task.files.slice(-HANDOFF_LIMITS.focusPaths),
            proof: compactProof(task),
            needs: [],
            turnsLeft: 1,
        };
    }
    ledger.handoff = validateHandoff(handoff);
}
function compactProof(task) {
    const proof = [];
    if (task.verification)
        proof.push(`Verification ${task.verification.status.toUpperCase()} (iteration ${task.verification.iteration}, exit ${task.verification.exitCode ?? 'unavailable'}).`);
    if (task.checker)
        proof.push(`Checker ${task.checker.status.toUpperCase()} by ${task.checker.label} (iteration ${task.checker.iteration}).`);
    if (task.result)
        proof.push(task.result);
    return proof.slice(-HANDOFF_LIMITS.proofItems).map((item) => item.slice(0, HANDOFF_LIMITS.itemChars));
}
export function addTaskEvent(ledger, message, now = new Date().toISOString()) {
    const compactMessage = message.replace(/\s+/g, ' ').trim().slice(0, TASK_LIMITS.eventChars);
    if (!compactMessage)
        invalid('event message must not be empty.');
    ledger.task.updatedAt = now;
    ledger.task.events.push({
        at: now,
        phase: ledger.task.phase,
        status: ledger.task.status,
        message: compactMessage,
    });
    ledger.task.events = ledger.task.events.slice(-TASK_LIMITS.events);
}
export function addAttempt(ledger, attempt) {
    ledger.attempts.push(attempt);
    ledger.attempts = ledger.attempts.slice(-TASK_LIMITS.attempts);
}
export function routeFailure(ledger, fallback, context) {
    const decision = checkCircuitBreaker(ledger, DEFAULT_BREAKER);
    if (decision.escalate) {
        ledger.task.phase = 'plan';
        ledger.task.status = 'blocked';
        ledger.task.blocker = `${context}: circuit breaker ${decision.trigger}: ${decision.reason}`.slice(0, TASK_LIMITS.textChars);
    }
    else {
        ledger.task.phase = fallback;
        ledger.task.status = 'active';
        delete ledger.task.blocker;
    }
}
export function createTaskLedger(objectiveValue, now = new Date().toISOString()) {
    const objective = boundedTaskText(objectiveValue, 'objective');
    const ledger = {
        goal: objective,
        startedAt: now,
        attempts: [],
        handoff: undefined,
        task: {
            schema: TASK_SCHEMA,
            objective,
            phase: 'task',
            status: 'active',
            iteration: 0,
            plan: [],
            files: [],
            updatedAt: now,
            events: [{ at: now, phase: 'task', status: 'active', message: 'Task started.' }],
        },
    };
    refreshHandoff(ledger);
    return ledger;
}
export async function readTaskLedger(statePath) {
    let raw;
    try {
        raw = await readFile(statePath, 'utf8');
    }
    catch (error) {
        const code = isRecord(error) ? error.code : undefined;
        if (code === 'ENOENT')
            throw new Error(`Task state not found at ${statePath}. Start one with loop task start <objective>.`);
        throw error;
    }
    if (raw.length > 256_000)
        invalid('state file exceeds 256000 characters.');
    return validateTaskLedger(JSON.parse(raw));
}
export async function writeTaskLedger(statePath, ledger) {
    refreshHandoff(ledger);
    const canonical = validateTaskLedger(ledger);
    const output = `${JSON.stringify(canonical, null, 2)}\n`;
    const target = path.resolve(statePath);
    const directory = path.dirname(target);
    await mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
    try {
        await writeFile(temporary, output, { encoding: 'utf8', flag: 'wx' });
        await rename(temporary, target);
    }
    catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
}
export function requirePhase(ledger, allowed, command) {
    if (ledger.task.status !== 'active' || !allowed.includes(ledger.task.phase)) {
        throw new Error(`${command} requires an active task in phase ${allowed.join(' or ')}; current state is ${ledger.task.phase}/${ledger.task.status}.`);
    }
}
export function verificationAndCheckerPassed(task) {
    return task.verification?.status === 'pass' && task.verification.iteration === task.iteration &&
        task.checker?.status === 'pass' && task.checker.iteration === task.iteration;
}
