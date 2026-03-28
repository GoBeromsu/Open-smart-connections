import { mkdirSync, statSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';

const DEFAULT_OBSIDIAN_TIMEOUT_MS = 15_000;
const DEFAULT_BUILD_TIMEOUT_MS = 120_000;
const RESTART_WAIT_MS = 5_000;

const vaultPath = process.env.OBSIDIAN_VAULT_PATH;
if (!vaultPath) {
  console.error('OBSIDIAN_VAULT_PATH is required');
  process.exit(1);
}

const pluginId = 'open-connections';
const pluginDir = join(vaultPath, '.obsidian', 'plugins', pluginId);
const artifactDir = join(process.cwd(), 'artifacts', 'freeze-runs');
mkdirSync(artifactDir, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function runProcess(command, args, { timeoutMs, env, shell = false } = {}) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        command,
        args,
        code,
        signal,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

async function runStep(name, kind, command, args, opts = {}) {
  const result = await runProcess(command, args, opts);
  return {
    name,
    kind,
    startedAt: nowIso(),
    ...result,
    ok: !result.timedOut && result.code === 0,
  };
}

function getPluginSnapshot() {
  if (!existsSync(pluginDir)) {
    return { exists: false, pluginDir };
  }
  const mainJs = join(pluginDir, 'main.js');
  return {
    exists: true,
    pluginDir,
    mainJsExists: existsSync(mainJs),
    mainJsMtime: existsSync(mainJs) ? statSync(mainJs).mtime.toISOString() : null,
  };
}

async function restartObsidian() {
  const steps = [];
  steps.push(
    await runStep(
      'kill-obsidian',
      'restart',
      'zsh',
      ['-lc', 'pkill -x Obsidian || true'],
      { timeoutMs: 10_000 },
    ),
  );
  steps.push(
    await runStep(
      'open-obsidian',
      'restart',
      'open',
      ['-a', 'Obsidian'],
      { timeoutMs: 10_000 },
    ),
  );
  await sleep(RESTART_WAIT_MS);
  return steps;
}

async function verifyAttempt(attempt) {
  const steps = [];

  steps.push(
    await runStep(
      'disable-plugin',
      'obsidian-cli',
      'obsidian',
      ['vault=Test', 'plugin:disable', `id=${pluginId}`],
      { timeoutMs: DEFAULT_OBSIDIAN_TIMEOUT_MS },
    ),
  );
  steps.push(
    await runStep(
      'flush-plugin-dir',
      'shell',
      'zsh',
      ['-lc', `rm -rf "${pluginDir}"`],
      { timeoutMs: 10_000 },
    ),
  );
  steps.push(
    await runStep(
      'build-and-deploy',
      'build',
      'zsh',
      ['-lc', 'pnpm run build'],
      {
        timeoutMs: DEFAULT_BUILD_TIMEOUT_MS,
        env: { DESTINATION_VAULTS: vaultPath },
      },
    ),
  );

  const responsiveSteps = [
    ['open-smoke-note', ['vault=Test', 'create', 'name=Open Connections Smoke', 'content=Runtime verification note for Open Connections.', 'overwrite', 'open']],
    ['enable-plugin', ['vault=Test', 'plugin:enable', `id=${pluginId}`]],
    ['reload-plugin', ['vault=Test', 'plugin:reload', `id=${pluginId}`]],
    ['clear-dev-errors', ['vault=Test', 'dev:errors', 'clear']],
    ['connections-view', ['vault=Test', 'command', 'id=open-connections:connections-view']],
    ['lookup-view', ['vault=Test', 'command', 'id=open-connections:open-lookup-view']],
    ['refresh-embeddings', ['vault=Test', 'command', 'id=open-connections:refresh-embeddings']],
    ['dev-errors', ['vault=Test', 'dev:errors']],
    ['dev-console-error', ['vault=Test', 'dev:console', 'level=error']],
  ];

  for (const [name, args] of responsiveSteps) {
    const step = await runStep(name, 'obsidian-cli', 'obsidian', args, {
      timeoutMs: DEFAULT_OBSIDIAN_TIMEOUT_MS,
    });
    steps.push(step);
    if (step.timedOut) {
      return {
        attempt,
        status: 'freeze',
        steps,
        pluginSnapshot: getPluginSnapshot(),
      };
    }
    if (!step.ok) {
      return {
        attempt,
        status: 'error',
        steps,
        pluginSnapshot: getPluginSnapshot(),
      };
    }
  }

  const devErrors = steps.find((step) => step.name === 'dev-errors');
  const devConsole = steps.find((step) => step.name === 'dev-console-error');
  const hasRuntimeErrors =
    !!devErrors?.stdout.trim() ||
    !!devErrors?.stderr.trim() ||
    !!devConsole?.stdout.trim() ||
    !!devConsole?.stderr.trim();

  return {
    attempt,
    status: hasRuntimeErrors ? 'error' : 'passed',
    steps,
    pluginSnapshot: getPluginSnapshot(),
  };
}

async function main() {
  const run = {
    startedAt: nowIso(),
    vaultPath,
    pluginId,
    freezeTimeoutMs: DEFAULT_OBSIDIAN_TIMEOUT_MS,
    attempts: [],
    restarts: [],
  };

  const firstAttempt = await verifyAttempt(1);
  run.attempts.push(firstAttempt);

  let finalStatus = firstAttempt.status;
  if (firstAttempt.status === 'freeze') {
    const restartSteps = await restartObsidian();
    run.restarts.push({ at: nowIso(), steps: restartSteps });
    const secondAttempt = await verifyAttempt(2);
    run.attempts.push(secondAttempt);
    finalStatus = secondAttempt.status === 'passed' ? 'passed_after_restart' : secondAttempt.status;
  }

  run.finishedAt = nowIso();
  run.status = finalStatus;

  const artifactPath = join(artifactDir, `${timestampSlug()}-${finalStatus}.json`);
  writeFileSync(artifactPath, JSON.stringify(run, null, 2));

  console.log(JSON.stringify({
    status: run.status,
    artifactPath,
    attempts: run.attempts.map((attempt) => ({
      attempt: attempt.attempt,
      status: attempt.status,
      timedOutSteps: attempt.steps.filter((step) => step.timedOut).map((step) => step.name),
    })),
    pluginSnapshot: run.attempts.at(-1)?.pluginSnapshot ?? null,
  }, null, 2));

  if (run.status === 'passed' || run.status === 'passed_after_restart') {
    process.exit(0);
  }
  process.exit(1);
}

await main();
