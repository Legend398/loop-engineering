import { type RunLogEntry, type LedgerSummary } from './files.js';
export interface StatusReport {
    target: string;
    patterns: string[];
    stateFile: string | null;
    lastRunFromState: string | null;
    ready: {
        score: number | null;
        level: string | null;
    };
    recentRuns: RunLogEntry[];
    ledger: LedgerSummary;
    budget: {
        present: boolean;
        path: string;
    };
    gate: {
        present: boolean;
    };
    constraints: {
        present: boolean;
    };
    nextHint: string;
}
export declare function runStatus(target: string): Promise<StatusReport>;
export declare function formatStatusHuman(r: StatusReport): string;
