import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { autoFixProject } from '../dist/autofixer.js';

/** Signals with every fixable gap closed except gate.yaml, so autoFixProject
 *  writes only that file (and never shells out to loop-init). */
function signalsMissingOnlyGateYaml() {
  return {
    stateFile: { present: true, paths: ['STATE.md'] },
    loopConfig: { present: true },
    skills: { count: 0, loopSkills: [] },
    verifier: { present: false },
    triage: { present: false },
    agentsMd: { present: true },
    patterns: { documented: false },
    safety: { loopMdMentionsSafety: false, safetyDocPresent: true },
    starters: { used: false },
    github: { present: false, workflows: false },
    mcp: { present: false },
    worktreeEvidence: { present: false },
    registry: { present: false },
    constraints: { present: true, hasConstraintsSkill: false },
    cost: { budgetDoc: true, runLog: true, loopMdBudget: false, budgetSkill: false },
    governance: { toolScope: false, stallDetection: false, escalation: false, gateYaml: false },
    loopActivity: { present: false, evidence: [] },
    harness: { stack: true, lock: false, sessions: false, emit: false, host: false },
    memory: { tiers: true, budget: false },
    fleet: { registry: false, inbox: false },
  };
}

test('autoFixProject writes a gate.yaml that loop-gate can actually load', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'loop-audit-autofix-'));
  try {
    await autoFixProject(root, { score: 0, level: 'L0', signals: signalsMissingOnlyGateYaml() });

    const written = await readFile(path.join(root, 'gate.yaml'), 'utf8');

    // This is the schema tools/loop-gate/src/gate.ts's loadGateConfig actually
    // requires -- { version: 1, denylist: string[], ... } -- not the
    // { gates: [...] } shape this template used to emit, which loop-gate
    // rejects outright.
    assert.match(written, /version:\s*1/);
    assert.match(written, /denylist:/);
    assert.doesNotMatch(written, /^gates:/m);
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});
