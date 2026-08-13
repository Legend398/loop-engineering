export type DoctorSeverity = 'healthy' | 'warning' | 'blocked';
export interface DoctorAction {
    priority: number;
    text: string;
    command?: string;
}
export interface DoctorReport {
    target: string;
    severity: DoctorSeverity;
    exitCode: number;
    ready: {
        score: number | null;
        level: string | null;
        assessment: string | null;
    };
    sync: {
        score: number | null;
        level: string | null;
        issueCount: number;
    };
    files: {
        state: string | null;
        loopMd: boolean;
        budget: boolean;
        runLog: boolean;
        constraints: boolean;
        gate: boolean;
        agentsMd: boolean;
    };
    actions: DoctorAction[];
    notes: string[];
}
export declare function runDoctor(target: string): Promise<DoctorReport>;
export declare function formatDoctorHuman(r: DoctorReport): string;
