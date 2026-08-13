export declare const HANDOFF_SCHEMA: 1;
export declare const HANDOFF_LIMITS: Readonly<{
    goalChars: 500;
    briefChars: 500;
    nextStepChars: 500;
    pathChars: 160;
    itemChars: 240;
    focusPaths: 8;
    proofItems: 6;
    needItems: 6;
    turns: 100;
    outputLines: 64;
    outputChars: 6000;
}>;
export declare const HANDOFF_AUTHORITY_NOTICE = "Current repository files, diffs, and tests are authoritative over this saved handoff.";
export type HandoffState = 'running' | 'waiting' | 'finished';
export interface Handoff {
    schema: typeof HANDOFF_SCHEMA;
    state: HandoffState;
    brief: string;
    nextStep?: string;
    focusPaths: string[];
    proof: string[];
    needs: string[];
    turnsLeft: number;
}
export interface ResumeView {
    goal: string;
    handoff: Handoff;
    authority: typeof HANDOFF_AUTHORITY_NOTICE;
}
/** Validate and return a canonical copy of the optional ledger handoff record. */
export declare function validateHandoff(value: unknown): Handoff;
/** Render a validated, deterministic, prompt-bounded continuity handoff. */
export declare function renderHandoff(value: unknown, goalValue: unknown): string;
export declare function buildResumeView(value: unknown, goalValue: unknown): ResumeView;
/** Render the structured resume view under the same hard output bounds as text mode. */
export declare function renderResumeJson(value: unknown, goalValue: unknown): string;
