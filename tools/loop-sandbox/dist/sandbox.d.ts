export interface SandboxOptions {
    shell?: boolean;
    base?: string;
    /**
     * Glob(s) to hold an advisory loop-worktree lock on for the run's duration,
     * so a scheduled loop can't touch the same paths concurrently. Unset by
     * default -- sandbox runs are unprotected unless the caller opts in.
     */
    lockPaths?: string[];
    /** Lock owner name; defaults to the run's generated id. */
    lockOwner?: string;
    /** e.g. "30m" -- passed straight through to loop-worktree's --ttl. */
    lockTtl?: string;
    /** e.g. "5m" -- passed straight through to loop-worktree's --wait. */
    lockWait?: string;
}
export interface SandboxResult {
    runId: string;
    patchFile: string | null;
    exitCode: number | null;
    hasChanges: boolean;
}
/**
 * Wraps an agent command in a temporary git worktree sandbox.
 * Returns the patch file path if changes were made.
 */
export declare function runInSandbox(root: string, command: string, args: string[], options?: SandboxOptions): Promise<SandboxResult>;
export interface ReviewItem {
    patchName: string;
    patchPath: string;
    size: number;
}
/** Lists all available patches in the .loop-sandbox/patches/ directory. */
export declare function listPatches(root: string): Promise<ReviewItem[]>;
