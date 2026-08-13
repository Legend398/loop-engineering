import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HANDOFF_AUTHORITY_NOTICE,
  HANDOFF_LIMITS,
  renderHandoff,
  renderResumeJson,
  validateHandoff,
} from '../dist/context-manager.js';

function running(overrides = {}) {
  return {
    schema: 1,
    state: 'running',
    brief: 'Resume the focused continuity work.',
    nextStep: 'Run the targeted tests.',
    focusPaths: ['src/index.ts', 'test/index.test.mjs'],
    proof: ['Typecheck passed.'],
    needs: [],
    turnsLeft: 3,
    ...overrides,
  };
}

test('validateHandoff accepts valid running, waiting, and finished records', () => {
  assert.equal(validateHandoff(running()).state, 'running');
  assert.equal(validateHandoff(running({
    state: 'waiting',
    nextStep: undefined,
    needs: ['Need an API token from the operator.'],
    turnsLeft: 0,
  })).state, 'waiting');
  assert.equal(validateHandoff(running({
    state: 'finished',
    nextStep: undefined,
    turnsLeft: 0,
  })).state, 'finished');
});

test('running requires a next step and positive turns', () => {
  assert.throws(() => validateHandoff(running({ nextStep: undefined })), /nextStep is required.*running/);
  assert.throws(() => validateHandoff(running({ turnsLeft: 0 })), /turnsLeft must be positive.*running/);
});

test('waiting requires at least one need or blocker', () => {
  assert.throws(
    () => validateHandoff(running({ state: 'waiting', nextStep: undefined, needs: [], turnsLeft: 0 })),
    /needs must contain at least one blocker.*waiting/,
  );
});

test('finished has no next step and zero turns', () => {
  assert.throws(() => validateHandoff(running({ state: 'finished', turnsLeft: 0 })), /nextStep must be omitted.*finished/);
  assert.throws(
    () => validateHandoff(running({ state: 'finished', nextStep: undefined, turnsLeft: 1 })),
    /turnsLeft must be 0.*finished/,
  );
});

test('focus paths reject absolute, traversal, backslash, and non-normalized forms', () => {
  for (const candidate of ['/etc/passwd', 'src/../secret', 'src\\index.ts', 'C:/repo/file.ts', './src/index.ts']) {
    assert.throws(
      () => validateHandoff(running({ focusPaths: [candidate] })),
      /focusPaths\[0\].*(forward slashes|normalized project-relative)/,
      candidate,
    );
  }
});

test('validation enforces named string, list, and turn bounds', () => {
  assert.throws(
    () => validateHandoff(running({ brief: 'x'.repeat(HANDOFF_LIMITS.briefChars + 1) })),
    new RegExp(`brief must be at most ${HANDOFF_LIMITS.briefChars}`),
  );
  assert.throws(
    () => validateHandoff(running({ proof: Array(HANDOFF_LIMITS.proofItems + 1).fill('proof') })),
    new RegExp(`proof must contain at most ${HANDOFF_LIMITS.proofItems}`),
  );
  assert.throws(
    () => validateHandoff(running({ turnsLeft: HANDOFF_LIMITS.turns + 1 })),
    new RegExp(`turnsLeft must be an integer from 0 to ${HANDOFF_LIMITS.turns}`),
  );
});

test('renderHandoff is deterministic, bounded, and states repository authority', () => {
  const maximal = running({
    brief: 'b'.repeat(HANDOFF_LIMITS.briefChars),
    nextStep: 'n'.repeat(HANDOFF_LIMITS.nextStepChars),
    focusPaths: Array.from({ length: HANDOFF_LIMITS.focusPaths }, (_, i) => `src/${i}-${'p'.repeat(150)}.ts`),
    proof: Array(HANDOFF_LIMITS.proofItems).fill('p'.repeat(HANDOFF_LIMITS.itemChars)),
    needs: Array(HANDOFF_LIMITS.needItems).fill('n'.repeat(HANDOFF_LIMITS.itemChars)),
    turnsLeft: HANDOFF_LIMITS.turns,
  });
  const goal = 'g'.repeat(HANDOFF_LIMITS.goalChars);
  const first = renderHandoff(maximal, goal);
  const second = renderHandoff(maximal, goal);
  assert.equal(first, second);
  assert.ok(first.split('\n').length <= HANDOFF_LIMITS.outputLines);
  assert.ok(first.length <= HANDOFF_LIMITS.outputChars);
  assert.match(first, new RegExp(`Goal: ${goal}`));
  assert.match(first, new RegExp(HANDOFF_AUTHORITY_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('validation and rendering do not mutate the source record', () => {
  const source = running({ brief: '  Keep whitespace deterministic.  ' });
  const before = structuredClone(source);
  validateHandoff(source);
  renderHandoff(source, 'Keep the goal authoritative.');
  assert.deepEqual(source, before);
});

test('missing and invalid handoffs fail with actionable messages', () => {
  assert.throws(() => validateHandoff(undefined), /handoff is missing.*Add a schema 1 handoff object.*--resume/);
  assert.throws(() => validateHandoff({ schema: 2 }), /handoff\.schema must be 1/);
  assert.throws(() => validateHandoff(running({ surprise: true })), /unsupported field: surprise/);
});

test('resume rendering requires a bounded canonical goal', () => {
  assert.throws(() => renderHandoff(running(), ''), /ledger\.goal must not be empty/);
  assert.throws(
    () => renderHandoff(running(), 'g'.repeat(HANDOFF_LIMITS.goalChars + 1)),
    new RegExp(`ledger\\.goal must be at most ${HANDOFF_LIMITS.goalChars}`),
  );
});

test('structured resume output enforces serialized character and physical line bounds', () => {
  const escaped = running({
    brief: '\\'.repeat(HANDOFF_LIMITS.briefChars),
    nextStep: '\\'.repeat(HANDOFF_LIMITS.nextStepChars),
    proof: Array.from({ length: HANDOFF_LIMITS.proofItems }, () => '\\'.repeat(HANDOFF_LIMITS.itemChars)),
    needs: Array.from({ length: HANDOFF_LIMITS.needItems }, () => '\\'.repeat(HANDOFF_LIMITS.itemChars)),
  });
  assert.throws(
    () => renderResumeJson(escaped, '\\'.repeat(HANDOFF_LIMITS.goalChars)),
    /bounded JSON resume output/,
  );

  const output = renderResumeJson(running(), 'ship continuity');
  assert.ok(output.length <= HANDOFF_LIMITS.outputChars);
  assert.ok(output.split('\n').length <= HANDOFF_LIMITS.outputLines);
  assert.equal(JSON.parse(output).goal, 'ship continuity');
});
