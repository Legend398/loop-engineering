import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  checkCircuitBreaker,
  DEFAULT_BREAKER,
  renderHandoff,
  renderResumeJson,
} from './context-manager.js';
import {
  TASK_LIMITS,
  addAttempt,
  addTaskEvent,
  boundedTaskText,
  createTaskLedger,
  DEFAULT_TASK_STATE,
  normalizeProjectPath,
  readTaskLedger,
  refreshHandoff,
  requirePhase,
  routeFailure,
  validateArgv,
  verificationAndCheckerPassed,
  writeTaskLedger,
  type TaskLedger,
} from './task-state.js';

const HELP = `loop task — executable Engineering Loop state machine

Usage:
  loop task start <objective> [--state <path>]
  loop task status [--json] [--state <path>]
  loop task plan <step...> [--state <path>]
  loop task implemented <summary> [--file <project-relative-path>...] [--state <path>]
  loop task verify [--state <path>] "--" <exact argv...>
  loop task check pass|fail <evidence> --checker <label> [--state <path>]
  loop task replan <reason> [--state <path>]
  loop task resume [--json] [--state <path>]
  loop task finish <summary> [--state <path>]
  loop task cancel <reason> [--state <path>]
  loop task --help

State defaults to ${DEFAULT_TASK_STATE}. Verification runs argv directly without a shell.
Repository files, diffs, and tests remain authoritative over saved state.
Checker independence is a role contract recorded by label; it is not mechanically authenticated.
`;

interface ParsedInvocation {
  command: string;
  args: string[];
  statePath: string;
}

function parseInvocation(argv: string[]): ParsedInvocation {
  const command = argv[0] ?? '--help';
  const separator = command === 'verify' ? argv.indexOf('--') : -1;
  const scanEnd = separator >= 0 ? separator : argv.length;
  const args: string[] = [command];
  let statePath = DEFAULT_TASK_STATE;
  for (let i = 1; i < argv.length; i++) {
    if (i < scanEnd && argv[i] === '--state') {
      const value = argv[++i];
      if (!value) throw new Error('--state requires a path.');
      statePath = value;
    } else {
      args.push(argv[i]);
    }
  }
  return { command, args: args.slice(1), statePath };
}

function takeFlag(args: string[], flag: string): { values: string[]; rest: string[] } {
  const values: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) {
      const value = args[++i];
      if (!value) throw new Error(`${flag} requires a value.`);
      values.push(value);
    } else {
      rest.push(args[i]);
    }
  }
  return { values, rest };
}

function textArgs(args: string[], field: string): string {
  return boundedTaskText(args.join(' '), field);
}

function displayCommand(argv: string[]): string {
  const rendered = argv.map((part) => /\s/.test(part) ? JSON.stringify(part) : part).join(' ');
  const max = TASK_LIMITS.textChars - 'verify '.length;
  return rendered.length <= max ? rendered : `${rendered.slice(0, max - 1)}…`;
}

function printBounded(output: string): void {
  if (output.length > TASK_LIMITS.statusChars) throw new Error('Task output exceeded its configured bound.');
  console.log(output);
}

function formatStatus(ledger: TaskLedger): string {
  const task = ledger.task;
  const decision = checkCircuitBreaker(ledger, DEFAULT_BREAKER);
  const lines = [
    `Task: ${task.objective}`,
    `State: ${task.phase}/${task.status}`,
    `Iteration: ${task.iteration}`,
    `Plan steps: ${task.plan.length}`,
    `Files: ${task.files.length ? task.files.join(', ') : '(none)'}`,
    `Circuit breaker: ${decision.escalate ? 'ESCALATE' : 'CONTINUE'} [${decision.trigger}]`,
  ];
  if (task.verification) lines.push(`Verification: ${task.verification.status.toUpperCase()} (iteration ${task.verification.iteration}, exit ${task.verification.exitCode ?? 'unavailable'})`);
  if (task.checker) lines.push(`Checker: ${task.checker.status.toUpperCase()} by ${task.checker.label} (iteration ${task.checker.iteration})`);
  if (task.blocker) lines.push(`Blocker: ${task.blocker}`);
  if (task.result) lines.push(`Result: ${task.result}`);
  return lines.join('\n');
}

function compactTail(value: string): string {
  return value.length <= 1000 ? value : value.slice(-1000);
}

function buildStatusView(ledger: TaskLedger): object {
  const task = ledger.task;
  return {
    goal: ledger.goal,
    phase: task.phase,
    status: task.status,
    iteration: task.iteration,
    plan: task.plan,
    files: task.files,
    ...(task.verification ? { verification: {
      iteration: task.verification.iteration,
      command: displayCommand(task.verification.command),
      status: task.verification.status,
      exitCode: task.verification.exitCode,
      outputTail: compactTail(task.verification.outputTail),
      recordedAt: task.verification.recordedAt,
    } } : {}),
    ...(task.checker ? { checker: task.checker } : {}),
    ...(task.blocker ? { blocker: task.blocker } : {}),
    ...(task.result ? { result: task.result } : {}),
    updatedAt: task.updatedAt,
    breaker: checkCircuitBreaker(ledger, DEFAULT_BREAKER),
  };
}

async function stateExists(statePath: string): Promise<boolean> {
  try {
    await access(statePath);
    return true;
  } catch {
    return false;
  }
}

async function start(statePath: string, args: string[]): Promise<number> {
  const objective = textArgs(args, 'objective');
  if (await stateExists(statePath)) {
    const existing = await readTaskLedger(statePath);
    if (existing.task.status !== 'completed' && existing.task.status !== 'cancelled') {
      throw new Error(`Cannot replace ${existing.task.phase}/${existing.task.status} task state. Finish or cancel it first.`);
    }
  }
  const ledger = createTaskLedger(objective);
  await writeTaskLedger(statePath, ledger);
  console.log(`Started task: ${ledger.goal}`);
  return 0;
}

async function status(statePath: string, args: string[]): Promise<number> {
  const json = args.includes('--json');
  const unknown = args.filter((arg) => arg !== '--json');
  if (unknown.length) throw new Error(`status does not accept: ${unknown.join(' ')}`);
  const ledger = await readTaskLedger(statePath);
  printBounded(json ? JSON.stringify(buildStatusView(ledger), null, 2) : formatStatus(ledger));
  return 0;
}

async function plan(statePath: string, args: string[]): Promise<number> {
  const ledger = await readTaskLedger(statePath);
  requirePhase(ledger, ['task', 'plan'], 'plan');
  if (!args.length) throw new Error('plan requires at least one step.');
  if (args.length > TASK_LIMITS.planItems) throw new Error(`plan accepts at most ${TASK_LIMITS.planItems} steps.`);
  ledger.task.plan = args.map((step, index) => boundedTaskText(step, `step[${index}]`));
  ledger.task.phase = 'implement';
  delete ledger.task.blocker;
  addTaskEvent(ledger, `Plan recorded with ${ledger.task.plan.length} step${ledger.task.plan.length === 1 ? '' : 's'}.`);
  await writeTaskLedger(statePath, ledger);
  console.log(`Plan recorded; task is ready for implementation.`);
  return 0;
}

async function implemented(statePath: string, args: string[]): Promise<number> {
  const parsed = takeFlag(args, '--file');
  const summary = textArgs(parsed.rest, 'implementation summary');
  const ledger = await readTaskLedger(statePath);
  requirePhase(ledger, ['implement'], 'implemented');
  const now = new Date().toISOString();
  ledger.task.iteration += 1;
  ledger.task.phase = 'verify';
  ledger.task.files = [...new Set(parsed.values.map((file, index) => normalizeProjectPath(file, `--file[${index}]`)))];
  ledger.task.implementation = { iteration: ledger.task.iteration, summary, recordedAt: now };
  delete ledger.task.verification;
  delete ledger.task.checker;
  delete ledger.task.blocker;
  addTaskEvent(ledger, `Implementation recorded for iteration ${ledger.task.iteration}.`, now);
  await writeTaskLedger(statePath, ledger);
  console.log(`Implementation recorded; iteration ${ledger.task.iteration} is ready for verification.`);
  return 0;
}

class OutputTail {
  private value = '';

  add(chunk: string): void {
    this.value += chunk;
    if (this.value.length > TASK_LIMITS.outputChars * 2) this.trim();
  }

  get(): string {
    this.trim();
    return this.value;
  }

  private trim(): void {
    if (this.value.length > TASK_LIMITS.outputChars) this.value = this.value.slice(-TASK_LIMITS.outputChars);
    const lines = this.value.split('\n');
    if (lines.length > TASK_LIMITS.outputLines) this.value = lines.slice(-TASK_LIMITS.outputLines).join('\n');
  }
}

async function spawnVerification(argv: string[]): Promise<{ exitCode: number | null; outputTail: string; error?: string }> {
  let resolved: { executable: string; args: string[] };
  try {
    resolved = await resolveVerificationCommand(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: null, outputTail: message, error: message };
  }
  return new Promise((resolve) => {
    const tail = new OutputTail();
    const child = spawn(resolved.executable, resolved.args, { shell: false, stdio: ['inherit', 'pipe', 'pipe'] });
    let launchError: string | undefined;
    child.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
      tail.add(chunk.toString());
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      tail.add(chunk.toString());
    });
    child.on('error', (error) => {
      launchError = error.message;
      tail.add(error.message);
    });
    child.on('close', (code) => resolve({ exitCode: code, outputTail: tail.get(), ...(launchError ? { error: launchError } : {}) }));
  });
}

async function resolveVerificationCommand(argv: string[]): Promise<{ executable: string; args: string[] }> {
  const executable = argv[0];
  if (process.platform === 'win32' && /[\\/]/.test(executable) && /\.(?:cmd|bat)$/i.test(executable)) {
    throw new Error('Path-qualified .cmd/.bat verification is not supported without a shell. Use an unqualified package manager such as "npx <tool>", or invoke a JavaScript/native executable entrypoint.');
  }
  if (process.platform !== 'win32' || /[\\/]/.test(executable)) {
    return { executable, args: argv.slice(1) };
  }
  const name = executable.toLowerCase().replace(/\.cmd$/, '');
  const scripts: Record<string, string[]> = {
    npm: ['node_modules/npm/bin/npm-cli.js'],
    npx: ['node_modules/npm/bin/npx-cli.js'],
    pnpm: ['node_modules/corepack/dist/pnpm.js', 'node_modules/pnpm/bin/pnpm.cjs'],
    pnpx: ['node_modules/corepack/dist/pnpx.js', 'node_modules/pnpm/bin/pnpx.cjs'],
    yarn: ['node_modules/corepack/dist/yarn.js', 'node_modules/yarn/bin/yarn.js'],
  };
  if (!scripts[name]) return { executable, args: argv.slice(1) };

  for (const directory of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const shim = path.join(directory, `${name}.cmd`);
    try {
      await access(shim);
    } catch {
      continue;
    }
    for (const relativeScript of scripts[name]) {
      const script = path.join(directory, relativeScript);
      try {
        await access(script);
        return { executable: process.execPath, args: [script, ...argv.slice(1)] };
      } catch {
        // Try the next known dependency-free shim target.
      }
    }
    throw new Error(`Cannot resolve the Node entrypoint behind ${shim}; verification was not run.`);
  }
  throw new Error(`Cannot find ${name}.cmd on PATH; verification was not run.`);
}

async function verify(statePath: string, args: string[]): Promise<number> {
  const separator = args.indexOf('--');
  if (separator !== 0 || args.length < 2) throw new Error('verify requires "--" followed by exact argv, for example: loop task verify "--" npm test.');
  const command = validateArgv(args.slice(1), 'verify argv');
  const ledger = await readTaskLedger(statePath);
  requirePhase(ledger, ['verify'], 'verify');
  const result = await spawnVerification(command);
  const now = new Date().toISOString();
  const passed = result.exitCode === 0 && !result.error;
  ledger.task.verification = {
    iteration: ledger.task.iteration,
    command,
    status: passed ? 'pass' : 'fail',
    exitCode: result.exitCode,
    outputTail: result.outputTail,
    recordedAt: now,
  };
  delete ledger.task.checker;
  addAttempt(ledger, {
    iteration: ledger.task.iteration,
    timestamp: now,
    action: `verify ${displayCommand(command)}`,
    outcome: passed ? 'success' : 'failure',
    ...(passed ? {} : { error: boundedTaskText(result.error ?? (result.outputTail || `Verification exited ${result.exitCode}.`), 'verification error', 2000) }),
  });
  if (passed) {
    ledger.task.phase = 'checker';
    ledger.task.status = 'active';
    delete ledger.task.blocker;
  } else {
    routeFailure(ledger, 'implement', 'Verification failed');
  }
  addTaskEvent(ledger, `Verification ${passed ? 'passed' : 'failed'} for iteration ${ledger.task.iteration}.`, now);
  await writeTaskLedger(statePath, ledger);
  console.log(`Verification ${passed ? 'PASS; independent checker evidence is required.' : `FAIL; task moved to ${ledger.task.phase}/${ledger.task.status}.`}`);
  return passed ? 0 : 2;
}

async function check(statePath: string, args: string[]): Promise<number> {
  const checker = takeFlag(args, '--checker');
  if (checker.values.length !== 1) throw new Error('check requires exactly one --checker <label>.');
  const verdict = checker.rest.shift();
  if (verdict !== 'pass' && verdict !== 'fail') throw new Error('check requires verdict pass or fail.');
  const evidence = textArgs(checker.rest, 'checker evidence');
  const ledger = await readTaskLedger(statePath);
  requirePhase(ledger, ['checker'], 'check');
  if (ledger.task.verification?.status !== 'pass' || ledger.task.verification.iteration !== ledger.task.iteration) {
    throw new Error('check requires same-iteration verification PASS.');
  }
  const now = new Date().toISOString();
  const label = boundedTaskText(checker.values[0], 'checker label', 160);
  ledger.task.checker = { iteration: ledger.task.iteration, label, status: verdict, evidence, recordedAt: now };
  addAttempt(ledger, {
    iteration: ledger.task.iteration,
    timestamp: now,
    action: `checker ${label}`,
    outcome: verdict === 'pass' ? 'success' : 'failure',
    ...(verdict === 'fail' ? { error: evidence } : {}),
  });
  if (verdict === 'pass') {
    ledger.task.phase = 'finish';
    ledger.task.status = 'active';
    delete ledger.task.blocker;
  } else {
    routeFailure(ledger, 'implement', 'Checker failed');
  }
  addTaskEvent(ledger, `Checker ${verdict.toUpperCase()} recorded from ${label}.`, now);
  await writeTaskLedger(statePath, ledger);
  console.log(`Checker ${verdict.toUpperCase()} recorded from ${label}; independence is a role contract and is not mechanically authenticated. Task is ${ledger.task.phase}/${ledger.task.status}.`);
  return verdict === 'pass' ? 0 : 2;
}

async function replan(statePath: string, args: string[]): Promise<number> {
  const reason = textArgs(args, 'replan reason');
  const ledger = await readTaskLedger(statePath);
  if (ledger.task.status === 'completed' || ledger.task.status === 'cancelled') throw new Error(`Cannot replan a ${ledger.task.status} task.`);
  ledger.task.phase = 'plan';
  ledger.task.status = 'active';
  ledger.attempts = [];
  delete ledger.task.implementation;
  delete ledger.task.verification;
  delete ledger.task.checker;
  delete ledger.task.blocker;
  addTaskEvent(ledger, `Replan requested: ${reason}`);
  await writeTaskLedger(statePath, ledger);
  console.log('Failure-attempt epoch reset; task is plan/active.');
  return 0;
}

async function resume(statePath: string, args: string[]): Promise<number> {
  const json = args.includes('--json');
  const unknown = args.filter((arg) => arg !== '--json');
  if (unknown.length) throw new Error(`resume does not accept: ${unknown.join(' ')}`);
  const ledger = await readTaskLedger(statePath);
  printBounded(json ? renderResumeJson(ledger.handoff, ledger.goal) : renderHandoff(ledger.handoff, ledger.goal));
  return 0;
}

async function finish(statePath: string, args: string[]): Promise<number> {
  const summary = textArgs(args, 'finish summary');
  const ledger = await readTaskLedger(statePath);
  requirePhase(ledger, ['finish'], 'finish');
  if (!verificationAndCheckerPassed(ledger.task)) throw new Error('finish requires same-iteration verification PASS and checker PASS.');
  ledger.task.status = 'completed';
  ledger.task.result = summary;
  delete ledger.task.blocker;
  addTaskEvent(ledger, 'Task completed with verification and checker evidence.');
  await writeTaskLedger(statePath, ledger);
  console.log(`Completed task: ${summary}`);
  return 0;
}

async function cancel(statePath: string, args: string[]): Promise<number> {
  const reason = textArgs(args, 'cancel reason');
  const ledger = await readTaskLedger(statePath);
  if (ledger.task.status === 'completed' || ledger.task.status === 'cancelled') throw new Error(`Task is already ${ledger.task.status}.`);
  ledger.task.phase = 'finish';
  ledger.task.status = 'cancelled';
  ledger.task.result = reason;
  delete ledger.task.blocker;
  addTaskEvent(ledger, `Task cancelled: ${reason}`);
  await writeTaskLedger(statePath, ledger);
  console.log(`Cancelled task: ${reason}`);
  return 0;
}

export async function runTaskCli(argv: string[]): Promise<number> {
  const invocation = parseInvocation(argv);
  switch (invocation.command) {
    case '--help':
    case '-h':
    case 'help':
      console.log(HELP);
      return 0;
    case 'start': return start(invocation.statePath, invocation.args);
    case 'status': return status(invocation.statePath, invocation.args);
    case 'plan': return plan(invocation.statePath, invocation.args);
    case 'implemented': return implemented(invocation.statePath, invocation.args);
    case 'verify': return verify(invocation.statePath, invocation.args);
    case 'check': return check(invocation.statePath, invocation.args);
    case 'replan': return replan(invocation.statePath, invocation.args);
    case 'resume': return resume(invocation.statePath, invocation.args);
    case 'finish': return finish(invocation.statePath, invocation.args);
    case 'cancel': return cancel(invocation.statePath, invocation.args);
    default: throw new Error(`Unknown task command: ${invocation.command}. Use loop task --help.`);
  }
}
