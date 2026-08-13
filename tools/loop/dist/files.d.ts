export declare function fileExists(p: string): Promise<boolean>;
export declare function readText(p: string): Promise<string | null>;
export declare function findStateFile(root: string): Promise<string | null>;
export interface RunLogEntry {
    run_id?: string;
    pattern?: string;
    outcome?: string;
    tokens_estimate?: number;
    readiness_score?: number;
    escalations?: number;
    items_found?: number;
    duration_s?: number;
    [key: string]: unknown;
}
/** Parse JSONL-ish entries from loop-run-log.md (lines that look like JSON objects). */
export declare function parseRunLog(content: string, limit?: number): RunLogEntry[];
export declare function extractLastRun(stateContent: string | null): string | null;
export declare function extractPatternsFromLoop(loopContent: string | null): string[];
export declare function budgetPresent(content: string | null): boolean;
export interface LedgerSummary {
    present: boolean;
    pattern?: string;
    level?: string;
    attempts?: number;
    open?: boolean;
}
export declare function parseLedger(raw: string | null): LedgerSummary;
