import { Finding, BaseAuditResult } from '@cobusgreyling/readiness-core';
export interface GoalSignals {
    goalFile: {
        present: boolean;
        path?: string;
    };
    goalConfig: {
        present: boolean;
    };
    skills: {
        count: number;
        goalSkills: string[];
    };
    verifier: {
        present: boolean;
    };
    scoper: {
        present: boolean;
    };
    agentsMd: {
        present: boolean;
        mentionsGoal: boolean;
    };
    patterns: {
        documented: boolean;
    };
    safety: {
        safetyDocPresent: boolean;
        budgetDoc: boolean;
    };
    tests: {
        present: boolean;
    };
    ci: {
        present: boolean;
    };
    runLog: {
        present: boolean;
    };
}
export type { Finding };
export interface AuditResult extends BaseAuditResult<'G0' | 'G1' | 'G2' | 'G3', GoalSignals> {
}
export declare function auditProject(target: string): Promise<AuditResult>;
//# sourceMappingURL=auditor.d.ts.map