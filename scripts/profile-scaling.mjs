import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_READY_TIMEOUT_MS = 60_000;
const DEFAULT_COUNTS = [0, 1000, 3000, 6000];
const DEFAULT_SAMPLES = 3;
const DEFAULT_STAGE_DIR = '99. Perf Bench/Ataraxia Sample';
const DEFAULT_PLUGIN_ID = 'open-connections';
const DEFAULT_VAULT_NAME = 'Test';

class ProfilingHarnessError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ProfilingHarnessError';
    this.details = details;
  }
}

function parseArgs(argv) {
  const options = {
    vaultName: DEFAULT_VAULT_NAME,
    pluginId: DEFAULT_PLUGIN_ID,
    counts: DEFAULT_COUNTS,
    samples: DEFAULT_SAMPLES,
    stageDir: DEFAULT_STAGE_DIR,
    sourceVaultPath: resolve(homedir(), 'Documents/01. Obsidian/Ataraxia'),
    testVaultPath: resolve(homedir(), 'Documents/01. Obsidian/Test'),
    artifactDir: resolve(process.cwd(), 'artifacts/issue-71-scaling'),
    screenshotEach: true,
    readyTimeoutMs: DEFAULT_READY_TIMEOUT_MS,
  };

  for (const arg of argv) {
    if (arg.startsWith('--counts=')) {
      options.counts = arg
        .slice('--counts='.length)
        .split(',')
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isFinite(value) && value >= 0);
    } else if (arg.startsWith('--samples=')) {
      const value = Number.parseInt(arg.slice('--samples='.length), 10);
      if (Number.isFinite(value) && value > 0) options.samples = value;
    } else if (arg.startsWith('--vault=')) {
      options.vaultName = arg.slice('--vault='.length);
    } else if (arg.startsWith('--plugin=')) {
      options.pluginId = arg.slice('--plugin='.length);
    } else if (arg.startsWith('--source=')) {
      options.sourceVaultPath = resolve(arg.slice('--source='.length));
    } else if (arg.startsWith('--test-vault-path=')) {
      options.testVaultPath = resolve(arg.slice('--test-vault-path='.length));
    } else if (arg.startsWith('--stage-dir=')) {
      options.stageDir = arg.slice('--stage-dir='.length);
    } else if (arg.startsWith('--artifact-dir=')) {
      options.artifactDir = resolve(arg.slice('--artifact-dir='.length));
    } else if (arg.startsWith('--ready-timeout-ms=')) {
      const value = Number.parseInt(arg.slice('--ready-timeout-ms='.length), 10);
      if (Number.isFinite(value) && value > 0) options.readyTimeoutMs = value;
    } else if (arg === '--no-screenshots') {
      options.screenshotEach = false;
    } else if (arg === '--help') {
      printHelp();
      process.exit(0);
    }
  }

  if (!options.counts.length) {
    throw new Error('At least one count is required. Example: --counts=0,1000,3000');
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/profile-scaling.mjs [options]\n\nOptions:\n  --counts=0,1000,3000   Markdown files copied from Ataraxia into Test for each batch\n  --samples=3            Repeated timing samples per command\n  --vault=Test           Obsidian vault name\n  --plugin=open-connections\n  --source=<path>        Source vault path (default: ~/Documents/01. Obsidian/Ataraxia)\n  --test-vault-path=<path>\n  --stage-dir=<relative-folder-in-test-vault>\n  --artifact-dir=<path>  Output directory for JSON artifacts\n  --ready-timeout-ms=60000  Wait budget for vault/runtime convergence\n  --no-screenshots       Skip per-batch screenshots\n`);
}

function nowIso() {
  return new Date().toISOString();
}

function slugTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function listMarkdownFiles(rootPath) {
  const results = [];
  const stack = [rootPath];

  while (stack.length) {
    const current = stack.pop();
    const entries = readdirSync(current, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.'))
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      results.push(fullPath);
    }
  }

  return results.sort((left, right) => left.localeCompare(right));
}

function resetStage(stageRoot) {
  rmSync(stageRoot, { recursive: true, force: true });
  mkdirSync(stageRoot, { recursive: true });
}

function stageFiles(sourceRoot, stageRoot, files) {
  for (const filePath of files) {
    const rel = relative(sourceRoot, filePath);
    const dest = join(stageRoot, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(filePath, dest, { force: true });
  }
}

function countMarkdownFiles(rootPath) {
  let total = 0;
  const stack = [rootPath];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        total += 1;
      }
    }
  }
  return total;
}

function runProcess(command, args, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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

function obsidianArgs(vaultName, ...args) {
  return [`vault=${vaultName}`, ...args];
}

function parseEvalJson(result) {
  const stdout = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => line.startsWith('=> ') || line.startsWith('{') || line.startsWith('['));

  if (!stdout) return null;
  const normalized = stdout.startsWith('=> ') ? stdout.slice(3) : stdout;
  if (!normalized) return null;

  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

function classifyCliFailure(text) {
  const value = (text ?? '').trim();
  if (!value) return 'empty_output';
  if (value === 'empty output') return 'empty_output';
  if (/timed? ?out/i.test(value)) return 'timeout';
  if (/did not converge/i.test(value)) return 'convergence_timeout';
  if (/Failed to parse runtime state/i.test(value)) return 'runtime_state_unavailable';
  return 'cli_error';
}

async function waitForPluginReady(vaultName, pluginId, timeoutMs = DEFAULT_READY_TIMEOUT_MS) {
  const startedAt = Date.now();
  let lastReadyState = null;
  while (Date.now() - startedAt < timeoutMs) {
    const result = await runProcess(
      'obsidian',
      obsidianArgs(
        vaultName,
        'eval',
        `code=(() => JSON.stringify({ ready: !!app.plugins?.plugins["${pluginId}"]?.ready, embedReady: !!app.plugins?.plugins["${pluginId}"]?.embed_ready }))()`
      ),
      10_000,
    );
    if (result.code === 0 && !result.timedOut) {
      const parsed = parseEvalJson(result);
      lastReadyState = parsed ?? lastReadyState;
      if (parsed?.ready) return parsed;
    }
    await sleep(1000);
  }
  throw new ProfilingHarnessError(
    `Plugin ${pluginId} did not become ready in ${timeoutMs}ms`,
    { classification: 'plugin_ready_timeout', lastReadyState },
  );
}

async function waitForRuntimeNoteCount(vaultName, expectedCount, timeoutMs = DEFAULT_READY_TIMEOUT_MS) {
  const startedAt = Date.now();
  let lastNoteCount = null;
  while (Date.now() - startedAt < timeoutMs) {
    const result = await runProcess(
      'obsidian',
      obsidianArgs(
        vaultName,
        'eval',
        'code=(() => JSON.stringify({ noteCount: app.vault.getMarkdownFiles().length }))()',
      ),
      10_000,
    );
    if (result.code === 0 && !result.timedOut) {
      const parsed = parseEvalJson(result);
      lastNoteCount = parsed?.noteCount ?? lastNoteCount;
      if (parsed?.noteCount === expectedCount) {
        return parsed.noteCount;
      }
    }
    await sleep(1000);
  }
  throw new ProfilingHarnessError(
    `Vault note count did not converge to ${expectedCount} in ${timeoutMs}ms (last=${lastNoteCount ?? 'unknown'})`,
    {
      classification: 'convergence_timeout',
      expectedNoteCount: expectedCount,
      lastNoteCount,
    },
  );
}

async function runTimedSamples(vaultName, samples, commands) {
  const results = {};
  for (const [name, args] of Object.entries(commands)) {
    const durations = [];
    for (let index = 0; index < samples; index += 1) {
      const result = await runProcess('obsidian', obsidianArgs(vaultName, ...args));
      if (result.code !== 0 || result.timedOut) {
        throw new Error(`${name} failed: code=${result.code} timedOut=${result.timedOut} stderr=${result.stderr.trim()}`);
      }
      durations.push(result.durationMs);
    }
    results[name] = {
      samplesMs: durations,
      meanMs: Number((durations.reduce((sum, value) => sum + value, 0) / durations.length).toFixed(1)),
      minMs: Number(Math.min(...durations).toFixed(1)),
      maxMs: Number(Math.max(...durations).toFixed(1)),
    };
  }
  return results;
}

async function captureScreenshot(vaultName) {
  const result = await runProcess('obsidian', obsidianArgs(vaultName, 'dev:screenshot'));
  if (result.code !== 0 || result.timedOut) {
    return { ok: false, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  }
  return { ok: true, path: result.stdout.trim() };
}

async function readRuntimeState(vaultName, pluginId, timeoutMs = DEFAULT_READY_TIMEOUT_MS) {
  const code = `code=(() => { const plugins = app.plugins?.plugins ?? {}; const plugin = plugins["${pluginId}"]; return JSON.stringify({ pluginCount: Object.keys(plugins).length, pluginKeys: Object.keys(plugins).sort(), openConnectionsLoaded: !!plugin, noteCount: app.vault.getMarkdownFiles().length, ready: !!plugin?.ready, embedReady: !!plugin?.embed_ready, sourceCount: plugin?.source_collection?.size ?? null, embeddedSourceCount: plugin?.source_collection?.embeddedCount ?? null, blockCount: plugin?.block_collection?.size ?? null, embeddedBlockCount: plugin?.block_collection?.embeddedCount ?? null, profiling: plugin?.getEmbedRuntimeState?.().profiling ?? null }); })()`;
  const startedAt = Date.now();
  let lastError = '';
  while (Date.now() - startedAt < timeoutMs) {
    const result = await runProcess('obsidian', obsidianArgs(vaultName, 'eval', code));
    if (result.code === 0 && !result.timedOut) {
      const parsed = parseEvalJson(result);
      if (parsed) return parsed;
      lastError = result.stdout.trim() || result.stderr.trim() || 'empty output';
    } else {
      lastError = result.stderr.trim() || result.stdout.trim() || `code=${result.code}`;
    }
    await sleep(1000);
  }
  throw new ProfilingHarnessError(
    `Failed to parse runtime state within ${timeoutMs}ms: ${lastError}`,
    {
      classification: classifyCliFailure(lastError),
      lastError,
    },
  );
}

async function verifySanitizedPluginState(vaultName, pluginId, timeoutMs = DEFAULT_READY_TIMEOUT_MS) {
  const runtime = await readRuntimeState(vaultName, pluginId, timeoutMs);
  const onlyTargetPlugin = runtime.pluginCount === 1
    && Array.isArray(runtime.pluginKeys)
    && runtime.pluginKeys.length === 1
    && runtime.pluginKeys[0] === pluginId;

  if (!onlyTargetPlugin) {
    throw new ProfilingHarnessError(
      `Sanitized Test vault preflight failed: expected only ${pluginId}, got ${JSON.stringify(runtime.pluginKeys)}`,
      {
        classification: 'unsanitized_vault',
        runtime,
      },
    );
  }

  return runtime;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourceVaultPath = statSync(options.sourceVaultPath).isDirectory() ? options.sourceVaultPath : null;
  const testVaultPath = statSync(options.testVaultPath).isDirectory() ? options.testVaultPath : null;
  if (!sourceVaultPath || !testVaultPath) {
    throw new Error('Source or Test vault path is invalid.');
  }

  const stageRoot = join(testVaultPath, options.stageDir);
  const sourceFiles = listMarkdownFiles(sourceVaultPath);
  ensureDir(options.artifactDir);

  const artifact = {
    startedAt: nowIso(),
    status: 'running',
    options: {
      ...options,
      sourceVaultPath,
      testVaultPath,
      stageRoot,
      availableSourceMarkdown: sourceFiles.length,
    },
    preflightStageMarkdownCount: countMarkdownFiles(stageRoot),
    batches: [],
  };

  let failure = null;

  try {
    artifact.preflight = await verifySanitizedPluginState(
      options.vaultName,
      options.pluginId,
      options.readyTimeoutMs,
    );

    for (const count of options.counts) {
      const selectedFiles = sourceFiles.slice(0, count);
      const batch = {
        requestedCount: count,
        selectedCount: selectedFiles.length,
        startedAt: nowIso(),
      };

      try {
        const copyStartedAt = Date.now();
        resetStage(stageRoot);
        stageFiles(sourceVaultPath, stageRoot, selectedFiles);
        batch.copyDurationMs = Date.now() - copyStartedAt;
        batch.stagedMarkdownCount = countMarkdownFiles(stageRoot);
        batch.testVaultMarkdownCount = countMarkdownFiles(testVaultPath);

        await waitForRuntimeNoteCount(options.vaultName, batch.testVaultMarkdownCount, options.readyTimeoutMs);
        await waitForPluginReady(options.vaultName, options.pluginId, options.readyTimeoutMs);
        batch.runtimeStateBefore = await readRuntimeState(options.vaultName, options.pluginId, options.readyTimeoutMs);
        batch.timing = await runTimedSamples(options.vaultName, options.samples, {
          pluginReload: ['plugin:reload', `id=${options.pluginId}`],
          connectionsView: ['command', `id=${options.pluginId}:connections-view`],
          evalState: ['eval', `code=(() => JSON.stringify({ pluginReady: !!app.plugins?.plugins["${options.pluginId}"]?.ready, noteCount: app.vault.getMarkdownFiles().length, blockCount: app.plugins?.plugins["${options.pluginId}"]?.block_collection?.size ?? null, embeddedBlockCount: app.plugins?.plugins["${options.pluginId}"]?.block_collection?.embeddedCount ?? null }))()`],
        });
        await runProcess('obsidian', obsidianArgs(options.vaultName, 'command', `id=${options.pluginId}:connections-view`));
        await sleep(500);
        await waitForPluginReady(options.vaultName, options.pluginId, options.readyTimeoutMs);
        await waitForRuntimeNoteCount(options.vaultName, batch.testVaultMarkdownCount, options.readyTimeoutMs);
        batch.runtimeStateAfter = await readRuntimeState(options.vaultName, options.pluginId, options.readyTimeoutMs);
        if (options.screenshotEach) {
          batch.screenshot = await captureScreenshot(options.vaultName);
        }
        batch.status = 'passed';
      } catch (error) {
        const details = error instanceof ProfilingHarnessError ? error.details : {};
        batch.status = 'failed';
        batch.failure = {
          message: error instanceof Error ? error.message : String(error),
          ...(details ?? {}),
        };
        if (options.screenshotEach) {
          batch.screenshot = await captureScreenshot(options.vaultName);
        }
        artifact.batches.push(batch);
        throw error;
      }

      batch.finishedAt = nowIso();
      artifact.batches.push(batch);
    }
    artifact.status = 'passed';
  } catch (error) {
    failure = {
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof ProfilingHarnessError ? error.details : {}),
    };
    artifact.status = 'failed';
    artifact.failure = failure;
  }

  artifact.finishedAt = nowIso();
  const artifactPath = join(options.artifactDir, `${slugTimestamp()}-issue-71-scaling.json`);
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  console.log(JSON.stringify({ artifactPath, status: artifact.status, batches: artifact.batches, failure }, null, 2));

  if (failure) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
