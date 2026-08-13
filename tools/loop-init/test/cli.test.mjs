import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const CLI = path.resolve('dist/cli.js');
const CODEBASE_MAP_AGENTS_START = '<!-- loop-engineering:codebase-map:start -->';
const CODEBASE_MAP_AGENTS_END = '<!-- loop-engineering:codebase-map:end -->';
const EXECUTION_LOOP_AGENTS_START = '<!-- loop-engineering:execution-loop:start -->';
const EXECUTION_LOOP_AGENTS_END = '<!-- loop-engineering:execution-loop:end -->';

test('bundle-assets tolerates concurrent rebuilds', async () => {
  await Promise.all([
    exec('node', ['scripts/bundle-assets.mjs']),
    exec('node', ['scripts/bundle-assets.mjs']),
  ]);
  await access(path.join('starters', 'issue-triage', 'README.md'));
  await access(path.join('templates', 'SKILL.md.issue-triage'));
  await access('registry.yaml');
});

test('loop-init --help exits 0', async () => {
  const { stdout } = await exec('node', [CLI, '--help']);
  assert.match(stdout, /changelog-drafter/);
  assert.match(stdout, /opencode/);
});

test('loop-init dry-run scaffolds daily-triage', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-'));
  try {
    const { stdout } = await exec('node', [
      CLI,
      dir,
      '--pattern',
      'daily-triage',
      '--tool',
      'grok',
      '--dry-run',
    ]);
    assert.match(stdout, /loop-init: daily-triage/);
    assert.match(stdout, /would copy|copied/);
    assert.match(stdout, /codebase-map/);
    await assert.rejects(() => access(path.join(dir, '.grok', 'skills', 'codebase-map', 'SKILL.md')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('codebase-map skill and scaffold template are byte-identical', async () => {
  const repoRoot = path.resolve('../..');
  const skill = await readFile(path.join(repoRoot, 'skills', 'codebase-map', 'SKILL.md'));
  const template = await readFile(path.join(repoRoot, 'templates', 'SKILL.md.codebase-map'));
  assert.deepEqual(skill, template);
});

test('execution-loop skill and scaffold template are byte-identical', async () => {
  const repoRoot = path.resolve('../..');
  const skill = await readFile(path.join(repoRoot, 'skills', 'execution-loop', 'SKILL.md'));
  const template = await readFile(path.join(repoRoot, 'templates', 'SKILL.md.execution-loop'));
  assert.deepEqual(skill, template);
});

test('loop-init preserves existing .gitignore content and adds one .loop entry on rerun', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-gitignore-existing-'));
  const gitignorePath = path.join(dir, '.gitignore');
  const existing = 'node_modules/\n.env\n';
  try {
    await writeFile(gitignorePath, existing);
    await exec('node', [CLI, dir, '--pattern', 'daily-triage', '--tool', 'claude']);
    const first = await readFile(gitignorePath, 'utf8');
    assert.ok(first.startsWith(existing));
    assert.equal(first.split('.loop/').length - 1, 1);

    await exec('node', [CLI, dir, '--pattern', 'daily-triage', '--tool', 'claude']);
    const second = await readFile(gitignorePath, 'utf8');
    assert.equal(second, first);
    assert.equal(second.split('.loop/').length - 1, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init dry-run reports .loop ignore without writing .gitignore', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-gitignore-dry-run-'));
  const gitignorePath = path.join(dir, '.gitignore');
  const existing = 'node_modules/\n';
  try {
    await writeFile(gitignorePath, existing);
    const { stdout } = await exec('node', [CLI, dir, '--pattern', 'daily-triage', '--tool', 'opencode', '--dry-run']);
    assert.match(stdout, /would append: \.gitignore \(\.loop\/\)/);
    assert.equal(await readFile(gitignorePath, 'utf8'), existing);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init scaffolds the execution-first default for Codex and Claude', async () => {
  const targets = {
    codex: ['.codex', 'skills', 'execution-loop', 'SKILL.md'],
    claude: ['.claude', 'skills', 'execution-loop', 'SKILL.md'],
  };
  for (const [tool, parts] of Object.entries(targets)) {
    const dir = await mkdtemp(path.join(tmpdir(), `loop-init-execution-loop-${tool}-`));
    try {
      await exec('node', [CLI, dir, '--pattern', 'daily-triage', '--tool', tool]);
      const skill = await readFile(path.join(dir, ...parts), 'utf8');
      assert.match(skill, /task -> plan -> implement -> verify -> checker -> finish/);
      assert.match(skill, /Auto-continue clear, reversible local work/);
      assert.match(skill, /loop task start "<objective>"/);
      assert.match(skill, /loop task verify "--" <executable> \[args\.\.\.\]/);
      assert.match(skill, /loop task check pass "<evidence>" --checker <label>/);
      assert.match(skill, /loop task check fail "<evidence>" --checker <label>/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test('loop-init does not overwrite an existing execution-loop skill', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-execution-loop-existing-'));
  const skillPath = path.join(dir, '.codex', 'skills', 'execution-loop', 'SKILL.md');
  try {
    await mkdir(path.dirname(skillPath), { recursive: true });
    await writeFile(skillPath, 'custom execution policy\n');
    await exec('node', [CLI, dir, '--pattern', 'daily-triage', '--tool', 'codex']);
    assert.equal(await readFile(skillPath, 'utf8'), 'custom execution policy\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init scaffolds the map-first default for Codex and Claude', async () => {
  const targets = {
    codex: ['.codex', 'skills', 'codebase-map', 'SKILL.md'],
    claude: ['.claude', 'skills', 'codebase-map', 'SKILL.md'],
  };
  for (const [tool, parts] of Object.entries(targets)) {
    const dir = await mkdtemp(path.join(tmpdir(), `loop-init-codebase-map-${tool}-`));
    try {
      await exec('node', [CLI, dir, '--pattern', 'daily-triage', '--tool', tool]);
      const skill = await readFile(path.join(dir, ...parts), 'utf8');
      assert.match(skill, /Use this discovery policy by default for unfamiliar code or cross-file work/);
      assert.match(skill, /architecture, ownership, dependencies, call flow, or data flow/);
      assert.match(skill, /create a full-repository index with persistence explicitly set to `false`/);
      assert.match(skill, /compact architecture view/);
      assert.match(skill, /targeted graph and code search/);
      assert.match(skill, /Keep the full graph and complete index outside the prompt/);
      assert.match(skill, /unavailable, stale, unsupported for the required operation, fails, or returns incomplete evidence/);
      assert.match(skill, /rg --files/);
      assert.match(skill, /Never auto-install, configure, authenticate, upgrade, or repair Codebase Memory/);
      assert.match(skill, /new indexes must explicitly use `persistence: false`/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test('loop-init does not overwrite an existing codebase-map skill', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-codebase-map-existing-'));
  const skillPath = path.join(dir, '.codex', 'skills', 'codebase-map', 'SKILL.md');
  try {
    await mkdir(path.dirname(skillPath), { recursive: true });
    await writeFile(skillPath, 'custom local policy\n');
    await exec('node', [CLI, dir, '--pattern', 'daily-triage', '--tool', 'codex']);
    assert.equal(await readFile(skillPath, 'utf8'), 'custom local policy\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init appends the marked Codex map-first block without replacing existing AGENTS.md', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-codex-agents-existing-'));
  const agentsPath = path.join(dir, 'AGENTS.md');
  const existing = '# Local project rules\n\nKeep this exact guidance.\n';
  try {
    await writeFile(agentsPath, existing);
    await exec('node', [CLI, dir, '--pattern', 'daily-triage', '--tool', 'codex']);
    const first = await readFile(agentsPath, 'utf8');
    assert.ok(first.startsWith(existing));
    assert.match(first, new RegExp(CODEBASE_MAP_AGENTS_START));
    assert.match(first, /use `\$codebase-map` before broad local scanning/);
    assert.match(first, /Codebase Memory is the default discovery route/);
    assert.match(first, new RegExp(CODEBASE_MAP_AGENTS_END));

    await exec('node', [CLI, dir, '--pattern', 'daily-triage', '--tool', 'codex']);
    const second = await readFile(agentsPath, 'utf8');
    assert.equal(second, first);
    assert.equal(second.split(CODEBASE_MAP_AGENTS_START).length - 1, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init appends one marked Codex execution-loop block and preserves AGENTS.md on rerun', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-execution-loop-agents-'));
  const agentsPath = path.join(dir, 'AGENTS.md');
  const existing = '# Local project rules\n\nKeep this exact guidance.\n';
  try {
    await writeFile(agentsPath, existing);
    await exec('node', [CLI, dir, '--pattern', 'daily-triage', '--tool', 'codex']);
    const first = await readFile(agentsPath, 'utf8');
    assert.ok(first.startsWith(existing));
    assert.match(first, new RegExp(CODEBASE_MAP_AGENTS_END));
    assert.match(first, new RegExp(EXECUTION_LOOP_AGENTS_START));
    assert.match(first, /use `\$execution-loop`/);
    assert.match(first, new RegExp(EXECUTION_LOOP_AGENTS_END));

    await exec('node', [CLI, dir, '--pattern', 'daily-triage', '--tool', 'codex']);
    const second = await readFile(agentsPath, 'utf8');
    assert.equal(second, first);
    assert.equal(second.split(EXECUTION_LOOP_AGENTS_START).length - 1, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init Codex dry-run reports the AGENTS map-first block without writing it', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-codex-agents-dry-run-'));
  try {
    const { stdout } = await exec('node', [
      CLI,
      dir,
      '--pattern',
      'daily-triage',
      '--tool',
      'codex',
      '--dry-run',
    ]);
    assert.match(stdout, /would append: AGENTS\.md \(Codex codebase-map block\)/);
    assert.match(stdout, /would append: AGENTS\.md \(Codex execution-loop block\)/);
    assert.match(stdout, /execution-loop/);
    await assert.rejects(() => access(path.join(dir, 'AGENTS.md')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init prints Loop Ready score after scaffold', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-audit-'));
  try {
    const { stdout } = await exec('node', [
      CLI,
      dir,
      '--pattern',
      'daily-triage',
      '--tool',
      'grok',
    ]);
    assert.match(stdout, /Loop Ready:/);
    assert.match(stdout, /\/100/);
    assert.match(stdout, /--badge/);
    assert.match(stdout, /Contribute \(~15 min tasks\):/);
    assert.match(stdout, /discussions\/123/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init scaffolds issue-triage with bundled assets', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-'));
  try {
    await exec('node', [CLI, dir, '--pattern', 'issue-triage', '--tool', 'grok']);
    await access(path.join(dir, 'issue-triage-state.md'));
    await access(path.join(dir, '.grok', 'skills', 'issue-triage', 'SKILL.md'));
    await access(path.join(dir, '.grok', 'skills', 'loop-verifier', 'SKILL.md'));
    await access(path.join(dir, 'loop-budget.md'));
    await access(path.join(dir, 'loop-run-log.md'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init scaffolds loop-intake for issue-triage', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-intake-'));
  try {
    const { stdout } = await exec('node', [CLI, dir, '--pattern', 'issue-triage', '--tool', 'grok']);
    await access(path.join(dir, '.grok', 'skills', 'loop-intake', 'SKILL.md'));
    assert.match(stdout, /Intake wired/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init does NOT scaffold loop-intake for report-only daily-triage', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-no-intake-'));
  try {
    await exec('node', [CLI, dir, '--pattern', 'daily-triage', '--tool', 'grok']);
    await assert.rejects(() => access(path.join(dir, '.grok', 'skills', 'loop-intake', 'SKILL.md')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init rejects unknown pattern', async () => {
  await assert.rejects(
    () => exec('node', [CLI, '.', '--pattern', 'not-a-pattern', '--tool', 'grok', '--dry-run']),
    (err) => err.stderr?.includes('Unknown pattern') || err.message?.includes('Unknown pattern'),
  );
});

test('loop-init rejects unknown tool', async () => {
  await assert.rejects(
    () => exec('node', [CLI, '.', '--pattern', 'daily-triage', '--tool', 'emacs', '--dry-run']),
    (err) => err.stderr?.includes('Unknown tool') || err.message?.includes('Unknown tool'),
  );
});

test('loop-init scaffolds daily-triage for opencode', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-opencode-'));
  try {
    await exec('node', [CLI, dir, '--pattern', 'daily-triage', '--tool', 'opencode']);
    await access(path.join(dir, 'STATE.md'));
    await access(path.join(dir, 'LOOP.md'));
    await access(path.join(dir, 'AGENTS.md'));
    await access(path.join(dir, 'opencode.json'));
    await access(path.join(dir, 'skills', 'loop-triage', 'SKILL.md'));
    await access(path.join(dir, 'loop-budget.md'));
    await access(path.join(dir, 'loop-run-log.md'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init scaffolds ci-sweeper with bundled assets', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-'));
  try {
    await exec('node', [CLI, dir, '--pattern', 'ci-sweeper', '--tool', 'grok']);
    await access(path.join(dir, 'ci-sweeper-state.md'));
    await access(path.join(dir, '.grok', 'skills', 'ci-triage', 'SKILL.md'));
    await access(path.join(dir, '.grok', 'skills', 'minimal-fix', 'SKILL.md'));
    await access(path.join(dir, '.grok', 'skills', 'loop-verifier', 'SKILL.md'));
    await access(path.join(dir, 'loop-budget.md'));
    await access(path.join(dir, 'loop-run-log.md'));
    await access(path.join(dir, '.grok', 'skills', 'loop-budget', 'SKILL.md'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init scaffolds circuit breaker (loop-guard + ledger) for fix patterns', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-cb-'));
  try {
    await exec('node', [CLI, dir, '--pattern', 'ci-sweeper', '--tool', 'grok']);
    await access(path.join(dir, '.grok', 'skills', 'loop-guard', 'SKILL.md'));
    const ledger = JSON.parse(await readFile(path.join(dir, 'loop-ledger.json'), 'utf8'));
    assert.equal(typeof ledger.goal, 'string');
    assert.ok(ledger.goal.length > 0);
    assert.equal(ledger.pattern, 'ci-sweeper');
    assert.match(ledger.level, /^L[123]$/);
    assert.deepEqual(ledger.attempts, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init scaffolds circuit breaker for pr-babysitter (opencode paths)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-cb-oc-'));
  try {
    await exec('node', [CLI, dir, '--pattern', 'pr-babysitter', '--tool', 'opencode']);
    await access(path.join(dir, 'skills', 'loop-guard', 'SKILL.md'));
    await access(path.join(dir, 'loop-ledger.json'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init scaffolds explicit unknown readiness states for pr-babysitter', async () => {
  const skillPaths = {
    grok: ['.grok', 'skills', 'pr-review-triage', 'SKILL.md'],
    claude: ['.claude', 'skills', 'pr-review-triage', 'SKILL.md'],
    codex: ['.codex', 'skills', 'pr-review-triage', 'SKILL.md'],
    opencode: ['skills', 'pr-review-triage', 'SKILL.md'],
  };

  for (const [tool, skillParts] of Object.entries(skillPaths)) {
    const dir = await mkdtemp(path.join(tmpdir(), `loop-init-pr-readiness-${tool}-`));
    try {
      await exec('node', [CLI, dir, '--pattern', 'pr-babysitter', '--tool', tool]);
      const skill = await readFile(path.join(dir, ...skillParts), 'utf8');
      assert.match(skill, /passing \| failing \| pending \| absent\/unknown/);
      assert.match(skill, /zero checks|no check runs/i);
      assert.match(skill, /mergeable[\s\S]*does\s+not mean[\s\S]*ready/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test('loop-init does NOT scaffold circuit breaker for report-only daily-triage', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-nocb-'));
  try {
    await exec('node', [CLI, dir, '--pattern', 'daily-triage', '--tool', 'grok']);
    await assert.rejects(() => access(path.join(dir, 'loop-ledger.json')));
    await assert.rejects(() => access(path.join(dir, '.grok', 'skills', 'loop-guard', 'SKILL.md')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init prints foundry CTA without --with-foundry', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-cta-'));
  try {
    const { stdout } = await exec('node', [CLI, dir, '--pattern', 'daily-triage', '--tool', 'grok']);
    assert.match(stdout, /--with-foundry/);
    assert.match(stdout, /harness-foundry/);
    await assert.rejects(() => access(path.join(dir, '.foundry', 'stack.yaml')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init --with-foundry scaffolds minimal stack for daily-triage', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-foundry-'));
  try {
    const { stdout } = await exec('node', [
      CLI,
      dir,
      '--pattern',
      'daily-triage',
      '--tool',
      'grok',
      '--with-foundry',
    ]);
    await access(path.join(dir, '.foundry', 'stack.yaml'));
    await access(path.join(dir, '.foundry', 'hooks', 'outerloop.yaml'));
    await access(path.join(dir, '.foundry', 'README.md'));
    const stack = await readFile(path.join(dir, '.foundry', 'stack.yaml'), 'utf8');
    assert.match(stack, /model\/mock/);
    assert.match(stack, /emit\/outerloop-evidence/);
    assert.match(stdout, /Harness stack ready/);
    assert.match(stdout, /preset: minimal/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init --with-foundry scaffolds implementer stack for ci-sweeper', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-foundry-impl-'));
  try {
    const { stdout } = await exec('node', [
      CLI,
      dir,
      '--pattern',
      'ci-sweeper',
      '--tool',
      'grok',
      '--with-foundry',
    ]);
    const stack = await readFile(path.join(dir, '.foundry', 'stack.yaml'), 'utf8');
    assert.match(stack, /model\/anthropic/);
    assert.match(stack, /tools\/git-worktree-write/);
    assert.match(stack, /recovery\/revert-on-test-fail/);
    assert.match(stdout, /preset: implementer/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init --help documents --with-foundry', async () => {
  const { stdout } = await exec('node', [CLI, '--help']);
  assert.match(stdout, /--with-foundry/);
  assert.match(stdout, /harness-foundry|implementer|minimal/);
});

test('loop-init --with-foundry --model-provider minimax emits MiniMax provider primitive', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-foundry-minimax-'));
  try {
    const { stdout } = await exec('node', [
      CLI,
      dir,
      '--pattern',
      'ci-sweeper',
      '--tool',
      'grok',
      '--with-foundry',
      '--model-provider',
      'minimax',
    ]);
    const stack = await readFile(path.join(dir, '.foundry', 'stack.yaml'), 'utf8');
    assert.match(stack, /primitive: model\/minimax/);
    assert.match(stack, /model: MiniMax-M3/);
    assert.match(stack, /- id: MiniMax-M3/);
    assert.match(stack, /- id: MiniMax-M2\.7/);
    assert.match(stack, /region: global_en/);
    // global endpoint
    assert.match(stack, /https:\/\/api\.minimax\.io\/v1/);
    // CN endpoint
    assert.match(stack, /https:\/\/api\.minimaxi\.com\/v1/);
    assert.doesNotMatch(stack, /model\/anthropic/);
    assert.match(stdout, /preset: implementer/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init --with-foundry minimax --region cn_zh selects CN region and model', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-foundry-minimax-cn-'));
  try {
    await exec('node', [
      CLI,
      dir,
      '--pattern',
      'ci-sweeper',
      '--tool',
      'grok',
      '--with-foundry',
      '--model-provider',
      'minimax',
      '--region',
      'cn_zh',
      '--model',
      'MiniMax-M2.7',
    ]);
    const stack = await readFile(path.join(dir, '.foundry', 'stack.yaml'), 'utf8');
    assert.match(stack, /region: cn_zh/);
    assert.match(stack, /model: MiniMax-M2\.7/);
    // both regional endpoints remain available in config
    assert.match(stack, /global_en:/);
    assert.match(stack, /cn_zh:/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init --with-foundry anthropic provider is unchanged (default)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-foundry-default-'));
  try {
    await exec('node', [
      CLI,
      dir,
      '--pattern',
      'ci-sweeper',
      '--tool',
      'grok',
      '--with-foundry',
    ]);
    const stack = await readFile(path.join(dir, '.foundry', 'stack.yaml'), 'utf8');
    assert.match(stack, /model\/anthropic/);
    assert.doesNotMatch(stack, /model\/minimax/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init rejects unknown model provider', async () => {
  await assert.rejects(
    () =>
      exec('node', [
        CLI,
        '.',
        '--pattern',
        'ci-sweeper',
        '--tool',
        'grok',
        '--with-foundry',
        '--model-provider',
        'not-a-provider',
        '--dry-run',
      ]),
    (err) =>
      err.stderr?.includes('Unknown model provider') ||
      err.message?.includes('Unknown model provider'),
  );
});

test('loop-init rejects unknown minimax model', async () => {
  await assert.rejects(
    () =>
      exec('node', [
        CLI,
        '.',
        '--pattern',
        'ci-sweeper',
        '--tool',
        'grok',
        '--with-foundry',
        '--model-provider',
        'minimax',
        '--model',
        'not-a-model',
        '--dry-run',
      ]),
    (err) => err.stderr?.includes('Unknown model') || err.message?.includes('Unknown model'),
  );
});

test('loop-init --help documents --model-provider minimax', async () => {
  const { stdout } = await exec('node', [CLI, '--help']);
  assert.match(stdout, /--model-provider/);
  assert.match(stdout, /minimax/);
});

test('loop-init prints memory CTA without --with-memory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-mem-cta-'));
  try {
    const { stdout } = await exec('node', [CLI, dir, '--pattern', 'daily-triage', '--tool', 'grok']);
    assert.match(stdout, /--with-memory/);
    assert.match(stdout, /memory-engineering/);
    await assert.rejects(() => access(path.join(dir, 'memory-tiers.md')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init --with-memory scaffolds tiers and budget', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-memory-'));
  try {
    const { stdout } = await exec('node', [
      CLI,
      dir,
      '--pattern',
      'daily-triage',
      '--tool',
      'grok',
      '--with-memory',
    ]);
    await access(path.join(dir, 'memory-tiers.md'));
    await access(path.join(dir, 'memory-budget.md'));
    const tiers = await readFile(path.join(dir, 'memory-tiers.md'), 'utf8');
    assert.match(tiers, /Working Memory/);
    assert.match(stdout, /Memory engineering stack ready/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init --help documents --with-memory', async () => {
  const { stdout } = await exec('node', [CLI, '--help']);
  assert.match(stdout, /--with-memory/);
  assert.match(stdout, /memory-engineering tiers and budget/);
});

test('loop-init prints fleet CTA without --with-fleet', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-fleet-cta-'));
  try {
    const { stdout } = await exec('node', [CLI, dir, '--pattern', 'daily-triage', '--tool', 'grok']);
    assert.match(stdout, /--with-fleet/);
    assert.match(stdout, /fleet-engineering/);
    await assert.rejects(() => access(path.join(dir, 'fleet-registry.md')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init --with-fleet scaffolds registry and inbox', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'loop-init-fleet-'));
  try {
    const { stdout } = await exec('node', [
      CLI,
      dir,
      '--pattern',
      'daily-triage',
      '--tool',
      'grok',
      '--with-fleet',
    ]);
    await access(path.join(dir, 'fleet-registry.md'));
    await access(path.join(dir, 'fleet-inbox.md'));
    const registry = await readFile(path.join(dir, 'fleet-registry.md'), 'utf8');
    assert.match(registry, /Fleet Registry/);
    assert.match(stdout, /Fleet engineering stack ready/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loop-init --help documents --with-fleet', async () => {
  const { stdout } = await exec('node', [CLI, '--help']);
  assert.match(stdout, /--with-fleet/);
  assert.match(stdout, /fleet-engineering registry and inbox/);
});

const SCAFFOLD_PATTERNS = {
  'daily-triage': {
    state: 'STATE.md',
    primarySkill: 'loop-triage',
    fixCapable: false,
    intake: false,
  },
  'pr-babysitter': {
    state: 'pr-babysitter-state.md',
    primarySkill: 'pr-review-triage',
    fixCapable: true,
    intake: false,
  },
  'ci-sweeper': {
    state: 'ci-sweeper-state.md',
    primarySkill: 'ci-triage',
    fixCapable: true,
    intake: false,
  },
  'dependency-sweeper': {
    state: 'dependency-sweeper-state.md',
    primarySkill: 'dependency-triage',
    fixCapable: true,
    intake: false,
  },
  'post-merge-cleanup': {
    state: 'post-merge-state.md',
    primarySkill: 'post-merge-scan',
    fixCapable: true,
    intake: false,
  },
  'changelog-drafter': {
    state: 'changelog-drafter-state.md',
    primarySkill: 'changelog-scan',
    fixCapable: false,
    intake: false,
  },
  'issue-triage': {
    state: 'issue-triage-state.md',
    primarySkill: 'issue-triage',
    fixCapable: false,
    intake: true,
  },
};

const SCAFFOLD_TOOLS = {
  grok: ['.grok', 'skills'],
  claude: ['.claude', 'skills'],
  codex: ['.codex', 'skills'],
  opencode: ['skills'],
};

async function expectPathExists(...parts) {
  await access(path.join(...parts));
}

async function expectPathMissing(...parts) {
  await assert.rejects(() => access(path.join(...parts)));
}

for (const [pattern, contract] of Object.entries(SCAFFOLD_PATTERNS)) {
  for (const [tool, skillRoot] of Object.entries(SCAFFOLD_TOOLS)) {
    test(`loop-init scaffold matrix: ${pattern} for ${tool}`, async () => {
      const dir = await mkdtemp(path.join(tmpdir(), `loop-init-matrix-${pattern}-${tool}-`));
      try {
        const { stdout } = await exec('node', [
          CLI,
          dir,
          '--pattern',
          pattern,
          '--tool',
          tool,
        ]);

        assert.match(stdout, new RegExp(`loop-init: ${pattern}`));
        await expectPathExists(dir, contract.state);
        await expectPathExists(dir, 'AGENTS.md');
        await expectPathExists(dir, 'loop-budget.md');
        await expectPathExists(dir, 'loop-run-log.md');
        await expectPathExists(dir, 'loop-constraints.md');
        await expectPathExists(dir, ...skillRoot, contract.primarySkill, 'SKILL.md');
        await expectPathExists(dir, ...skillRoot, 'loop-budget', 'SKILL.md');
        await expectPathExists(dir, ...skillRoot, 'loop-constraints', 'SKILL.md');
        await expectPathExists(dir, ...skillRoot, 'codebase-map', 'SKILL.md');
        await expectPathExists(dir, ...skillRoot, 'execution-loop', 'SKILL.md');

        if (tool === 'codex') {
          const agents = await readFile(path.join(dir, 'AGENTS.md'), 'utf8');
          assert.match(agents, new RegExp(CODEBASE_MAP_AGENTS_START));
          assert.match(agents, /Codebase Memory is the default discovery route/);
          assert.match(agents, new RegExp(EXECUTION_LOOP_AGENTS_START));
          assert.match(agents, /use `\$execution-loop`/);
        }

        if (tool === 'opencode') {
          await expectPathExists(dir, 'opencode.json');
        }

        if (contract.fixCapable) {
          await expectPathExists(dir, 'loop-ledger.json');
          await expectPathExists(dir, ...skillRoot, 'minimal-fix', 'SKILL.md');
          await expectPathExists(dir, ...skillRoot, 'loop-guard', 'SKILL.md');

          const ledger = JSON.parse(await readFile(path.join(dir, 'loop-ledger.json'), 'utf8'));
          assert.equal(ledger.pattern, pattern);
          assert.match(ledger.level, /^L[12]$/);
          assert.deepEqual(ledger.attempts, []);
        } else {
          await expectPathMissing(dir, 'loop-ledger.json');
          await expectPathMissing(dir, ...skillRoot, 'loop-guard', 'SKILL.md');
        }

        if (contract.intake) {
          await expectPathExists(dir, ...skillRoot, 'loop-intake', 'SKILL.md');
        } else {
          await expectPathMissing(dir, ...skillRoot, 'loop-intake', 'SKILL.md');
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
}
