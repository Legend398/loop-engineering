#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { printContributorCta } from './contributor-cta.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const MONOREPO_TEMPLATES = path.resolve(PACKAGE_ROOT, '../../templates');
function parseArgs(argv) {
    let tool = 'grok';
    let target = '.';
    let dryRun = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--tool' || a === '-t')
            tool = argv[++i];
        else if (a === '--dry-run')
            dryRun = true;
        else if (a === '--help' || a === '-h')
            return { help: true, tool, target, dryRun };
        else if (!a.startsWith('-'))
            target = a;
    }
    return { help: false, tool, target, dryRun };
}
async function exists(p) {
    try {
        await access(p);
        return true;
    }
    catch {
        return false;
    }
}
async function copyFile(src, dest, dryRun) {
    if (!(await exists(src))) {
        console.error(`Warning: Template not found at ${src}`);
        return false;
    }
    if (dryRun) {
        console.log(`  would copy: ${src} → ${dest}`);
        return true;
    }
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(src, dest);
    console.log(`  copied: ${path.basename(src)} → ${dest}`);
    return true;
}
async function resolveBundledOrMonorepo(name) {
    const bundled = path.join(PACKAGE_ROOT, name);
    if (await exists(bundled))
        return bundled;
    return MONOREPO_TEMPLATES;
}
async function copyTemplateSkill(templatesRoot, templateFile, targetDir, tool, skillName, dryRun) {
    const src = path.join(templatesRoot, templateFile);
    const destByTool = {
        grok: path.join(targetDir, '.grok', 'skills', skillName, 'SKILL.md'),
        claude: path.join(targetDir, '.claude', 'skills', skillName, 'SKILL.md'),
        codex: path.join(targetDir, '.codex', 'skills', skillName, 'SKILL.md'),
        opencode: path.join(targetDir, 'skills', skillName, 'SKILL.md'),
    };
    const dest = destByTool[tool];
    if (await exists(dest))
        return;
    await copyFile(src, dest, dryRun);
}
async function resolveAuditCli() {
    const monorepo = path.resolve(PACKAGE_ROOT, '../goal-audit/dist/cli.js');
    if (await exists(monorepo))
        return monorepo;
    try {
        const { createRequire } = await import('node:module');
        const require = createRequire(import.meta.url);
        const pkg = require.resolve('@cobusgreyling/goal-audit/package.json');
        return path.join(path.dirname(pkg), 'dist/cli.js');
    }
    catch {
        return null;
    }
}
async function runAuditJson(cli, targetDir) {
    return new Promise((resolve, reject) => {
        const child = spawn('node', [cli, targetDir, '--json'], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', () => {
            if (stdout.trim())
                resolve(stdout);
            else
                reject(new Error('goal-audit produced no output'));
        });
    });
}
async function runAuditSummary(targetDir) {
    const cli = await resolveAuditCli();
    if (!cli)
        return null;
    try {
        const stdout = await runAuditJson(cli, targetDir);
        return JSON.parse(stdout);
    }
    catch {
        return null;
    }
}
function formatScoreBar(score, width = 20) {
    const filled = Math.max(0, Math.min(width, Math.round((score / 100) * width)));
    return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}  ${score}/100`;
}
function auditTargetArg(target, targetDir) {
    return target === '.' ? '.' : targetDir;
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(`goal-init — scaffold goal engineering configurations

Usage:
  goal-init [target-dir] --tool <grok|claude|codex|opencode>

Options:
  -t, --tool      Tool target (default: grok)
  --dry-run       Print actions without copying
  -h, --help      This help

Examples:
  npx @cobusgreyling/goal-init . --tool grok
  npx @cobusgreyling/goal-init . -t claude
`);
        process.exit(0);
    }
    const { tool, target, dryRun } = args;
    const validTools = ['grok', 'claude', 'codex', 'opencode'];
    if (!validTools.includes(tool)) {
        console.error(`Unknown tool: ${tool}. Valid: ${validTools.join(', ')}`);
        process.exit(1);
    }
    const targetDir = path.resolve(target);
    const templatesRoot = await resolveBundledOrMonorepo('templates');
    console.log(`\ngoal-init: Scaffolding Goal Workflows → ${targetDir} (${tool})${dryRun ? ' [dry-run]' : ''}\n`);
    // 1. Scaffold GOAL.md
    if (!(await exists(path.join(targetDir, 'GOAL.md')))) {
        await copyFile(path.join(templatesRoot, 'GOAL.md.template'), path.join(targetDir, 'GOAL.md'), dryRun);
    }
    // 2. Scaffold goal-budget.md
    if (!(await exists(path.join(targetDir, 'goal-budget.md')))) {
        await copyFile(path.join(templatesRoot, 'goal-budget.md.template'), path.join(targetDir, 'goal-budget.md'), dryRun);
    }
    // 3. Scaffold goal-run-log.md
    if (!(await exists(path.join(targetDir, 'goal-run-log.md')))) {
        await copyFile(path.join(templatesRoot, 'goal-run-log.md.template'), path.join(targetDir, 'goal-run-log.md'), dryRun);
    }
    // 3.5 Scaffold docs/safety.md
    const safetyPath = path.join(targetDir, 'docs', 'safety.md');
    if (!(await exists(safetyPath)) && !dryRun) {
        await mkdir(path.dirname(safetyPath), { recursive: true });
        await writeFile(safetyPath, '# Safety Policy\n\nEnsure any autonomous tools adhere to safety guidelines.\n');
        console.log('  created: docs/safety.md (stub)');
    }
    else if (dryRun) {
        console.log(`  would create: docs/safety.md (stub)`);
    }
    // 4. Scaffold skills
    await copyTemplateSkill(templatesRoot, 'SKILL.md.goal-verifier', targetDir, tool, 'goal-verifier', dryRun);
    await copyTemplateSkill(templatesRoot, 'SKILL.md.goal-scoper', targetDir, tool, 'goal-scoper', dryRun);
    // 5. Scaffold or Update AGENTS.md
    const agentsPath = path.join(targetDir, 'AGENTS.md');
    if (!(await exists(agentsPath)) && !dryRun) {
        const agentsTemplate = `# AGENTS.md

## Goal Engineering Rules
- Use /goal and update_goal.
- \`goal-verifier\` MUST PASS before setting completed: true in GOAL.md.
`;
        await writeFile(agentsPath, agentsTemplate);
        console.log('  created: AGENTS.md (template)');
    }
    else if (!dryRun) {
        const content = await readFile(agentsPath, 'utf8');
        if (!/goal|update_goal|GOAL\.md/i.test(content)) {
            await writeFile(agentsPath, content + '\n## Goal Engineering Rules\n- Use /goal and update_goal.\n- `goal-verifier` MUST PASS before setting completed: true in GOAL.md.\n');
            console.log('  updated: AGENTS.md (appended goal rules)');
        }
    }
    const auditArg = auditTargetArg(target, targetDir);
    if (!dryRun) {
        const audit = await runAuditSummary(targetDir);
        if (audit) {
            console.log('');
            console.log(`✓ Goal Ready: ${audit.score}/100 (${audit.level})`);
            console.log(`  ${formatScoreBar(audit.score)}`);
            console.log(`  ${audit.assessment}`);
            console.log('');
            console.log('Paste badge in README:');
            console.log(`  npx @cobusgreyling/goal-audit ${auditArg} --badge`);
        }
        else {
            console.log('\n=== Goal Ready score ===');
            console.log(`  npx @cobusgreyling/goal-audit ${auditArg} --suggest`);
        }
    }
    console.log('');
    console.log(`To start a new goal (${tool}):`);
    console.log(`  Update GOAL.md and run: /goal Read GOAL.md. Work the objective. goal-verifier before completed: true.`);
    printContributorCta();
}
main().catch((err) => {
    console.error('goal-init failed:', err instanceof Error ? err.message : err);
    process.exit(1);
});
