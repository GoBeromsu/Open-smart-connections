import { mkdirSync, statSync, existsSync, writeFileSync, realpathSync } from 'fs';
import { join, resolve } from 'path';
import { spawn } from 'child_process';

const DEFAULT_OBSIDIAN_TIMEOUT_MS = 15_000;
const DEFAULT_BUILD_TIMEOUT_MS = 120_000;
const RESTART_WAIT_MS = 5_000;

const vaultPath = process.env.OBSIDIAN_VAULT_PATH;
if (!vaultPath) {
  console.error('OBSIDIAN_VAULT_PATH is required');
  process.exit(1);
}
const vaultName = process.env.OBSIDIAN_VAULT_NAME ?? 'Test';
const vaultArg = `vault=${vaultName}`;

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

function normalizePath(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function parseObsidianEvalOutput(output) {
  return output.trim().replace(/^=>\s*/, '').trim();
}

function hasProblemOutput(step, cleanMessages = []) {
  const output = `${step?.stdout ?? ''}\n${step?.stderr ?? ''}`.trim();
  if (!output) {
    return false;
  }
  return !cleanMessages.some((message) => output === message);
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
      ['-a', 'Obsidian', vaultPath],
      { timeoutMs: 10_000 },
    ),
  );
  await sleep(RESTART_WAIT_MS);
  return steps;
}

async function verifyAttempt(attempt) {
  const steps = [];

  const targetVaultStep = await runStep(
    'verify-vault-target',
    'obsidian-cli',
    'obsidian',
    [vaultArg, 'eval', 'code=app.vault.adapter.basePath ?? ""'],
    { timeoutMs: DEFAULT_OBSIDIAN_TIMEOUT_MS },
  );
  const actualVaultPath = parseObsidianEvalOutput(targetVaultStep.stdout);
  const expectedVaultPath = normalizePath(vaultPath);
  const actualNormalizedPath = actualVaultPath ? normalizePath(actualVaultPath) : '';
  if (!targetVaultStep.ok || actualNormalizedPath !== expectedVaultPath) {
    targetVaultStep.ok = false;
    targetVaultStep.stderr += `\nVault target mismatch: ${vaultArg} resolved to "${actualVaultPath || '<empty>'}", expected "${vaultPath}".`;
    steps.push(targetVaultStep);
    return {
      attempt,
      status: 'error',
      steps,
      pluginSnapshot: getPluginSnapshot(),
    };
  }
  steps.push(targetVaultStep);

  steps.push(
    await runStep(
      'disable-plugin',
      'obsidian-cli',
      'obsidian',
      [vaultArg, 'plugin:disable', `id=${pluginId}`],
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
    ['open-smoke-note', [vaultArg, 'create', 'name=Open Connections Smoke', 'content=Runtime verification note for Open Connections.', 'overwrite', 'open']],
    ['enable-plugin', [vaultArg, 'plugin:enable', `id=${pluginId}`]],
    ['reload-plugin', [vaultArg, 'plugin:reload', `id=${pluginId}`]],
    ['clear-dev-errors', [vaultArg, 'dev:errors', 'clear']],
    ['clear-dev-console', [vaultArg, 'dev:console', 'clear']],
    ['connections-view', [vaultArg, 'command', 'id=open-connections:connections-view']],
    ['lookup-view', [vaultArg, 'command', 'id=open-connections:open-lookup-view']],
    ['refresh-embeddings', [vaultArg, 'command', 'id=open-connections:refresh-embeddings']],
    ['dev-errors', [vaultArg, 'dev:errors']],
    ['dev-console-error', [vaultArg, 'dev:console', 'level=error']],
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
    hasProblemOutput(devErrors, ['No errors captured.']) ||
    hasProblemOutput(devConsole, ['No console messages captured.']);

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
    vaultName,
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
