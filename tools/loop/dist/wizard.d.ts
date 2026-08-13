export interface PainOption {
    id: string;
    label: string;
    pattern: string;
}
export declare const PAIN_OPTIONS: PainOption[];
export declare const TOOLS: readonly ["grok", "claude", "codex", "opencode"];
export type WizardTool = (typeof TOOLS)[number];
export interface WizardPlan {
    pattern: string;
    tool: WizardTool;
    target: string;
    withFoundry: boolean;
}
export declare function defaultPlan(): WizardPlan;
export declare function formatWizardBanner(): string;
export declare function formatPainMenu(): string;
export declare function resolvePattern(answer: string): string;
export declare function resolveTool(answer: string): WizardTool;
export declare function runInteractiveWizard(): Promise<WizardPlan>;
export declare function printNonInteractiveHelp(): void;
/** Run init with plan, then doctor. */
export declare function executePlan(plan: WizardPlan): Promise<number>;
