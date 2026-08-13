import { type Attempt, type Ledger } from './context-manager.js';
import { type Handoff } from './handoff.js';
export declare const DEFAULT_TASK_STATE = ".loop/task.json";
export declare const TASK_SCHEMA: 1;
export type TaskPhase = 'task' | 'plan' | 'implement' | 'verify' | 'checker' | 'finish';
export type TaskStatus = 'active' | 'blocked' | 'completed' | 'cancelled';
export type EvidenceStatus = 'pass' | 'fail';
export interface TaskEvent {
    at: string;
    phase: TaskPhase;
    status: TaskStatus;
    message: string;
}
export interface ImplementationEvidence {
    iteration: number;
    summary: string;
    recordedAt: string;
}
export interface VerificationEvidence {
    iteration: number;
    command: string[];
    status: EvidenceStatus;
    exitCode: number | null;
    outputTail: string;
    workspaceFingerprint?: string;
    recordedAt: string;
}
export interface CheckerEvidence {
    iteration: number;
    label: string;
    status: EvidenceStatus;
    evidence: string;
    recordedAt: string;
}
export interface TaskRecord {
    schema: typeof TASK_SCHEMA;
    objective: string;
    phase: TaskPhase;
    status: TaskStatus;
    iteration: number;
    plan: string[];
    files: string[];
    implementation?: ImplementationEvidence;
    verification?: VerificationEvidence;
    checker?: CheckerEvidence;
    result?: string;
    blocker?: string;
    updatedAt: string;
    events: TaskEvent[];
}
export interface TaskLedger extends Ledger {
    startedAt: string;
    handoff: Handoff;
    task: TaskRecord;
}
export declare const TASK_LIMITS: Readonly<{
    textChars: 500;
    eventChars: 240;
    planItems: 8;
    fileItems: 16;
    events: 20;
    attempts: 10;
    argvItems: 32;
    argvChars: 1000;
    outputChars: 4000;
    outputLines: 40;
    statusChars: 12000;
}>;
export declare function boundedTaskText(value: unknown, field: string, max?: number): string;
export declare function validateArgv(value: unknown, field?: string): string[];
export declare function normalizeProjectPath(value: unknown, field?: string): string;
export declare function validateTaskLedger(value: unknown): TaskLedger;
export declare function refreshHandoff(ledger: TaskLedger): void;
export declare function addTaskEvent(ledger: TaskLedger, message: string, now?: string): void;
export declare function addAttempt(ledger: TaskLedger, attempt: Attempt): void;
export declare function routeFailure(ledger: TaskLedger, fallback: TaskPhase, context: string): void;
export declare function createTaskLedger(objectiveValue: unknown, now?: string): TaskLedger;
export declare function readTaskLedger(statePath: string): Promise<TaskLedger>;
export declare function writeTaskLedger(statePath: string, ledger: TaskLedger): Promise<void>;
export declare function requirePhase(ledger: TaskLedger, allowed: TaskPhase[], command: string): void;
export declare function verificationAndCheckerPassed(task: TaskRecord): boolean;
