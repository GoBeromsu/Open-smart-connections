import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { rankFlowSummaries, summarizeScalingRun, summarizeScriptRun } from './profile-flow-report.mjs';

function parseArgs(argv) {
  const options = {
    vault: 'Test',
    freezeWait: 30,
    embedBlocks: 100,
    embedMaxTime: 60,
    lookupTimeout: 30,
    e2eMaxWait: 300,
    counts: '0,1000,3000,6000',
    artifactDir: resolve(process.cwd(), 'artifacts/freeze-flows'),
    vaultPath: null,
    sourceVaultPath: null,
    testVaultPath: null,
  };

  for (const arg of argv) {
    const [key, value] = arg.split('=');
    if (key === '--vault' && value) options.vault = value;
    if (key === '--freeze-wait' && value) options.freezeWait = Number.parseInt(value, 10);
    if (key === '--embed-blocks' && value) options.embedBlocks = Number.parseInt(value, 10);
    if (key === '--embed-max-time' && value) options.embedMaxTime = Number.parseInt(value, 10);
    if (key === '--lookup-timeout' && value) options.lookupTimeout = Number.parseInt(value, 10);
    if (key === '--e2e-max-wait' && value) options.e2eMaxWait = Number.parseInt(value, 10);
    if (key === '--counts' && value) options.counts = value;
    if (key === '--artifact-dir' && value) options.artifactDir = resolve(value);
    if (key === '--vault-path' && value) options.vaultPath = resolve(value);
    if (key === '--source-vault-path' && value) options.sourceVaultPath = resolve(value);
    if (key === '--test-vault-path' && value) options.testVaultPath = resolve(value);
  }

  return options;
}

function run(command, args, cwd = process.cwd(), env = {}) {
  return new Promise((resolveRun) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('close', (code) => {
      resolveRun({ code, stdout, stderr, durationMs: Date.now() - startedAt, timedOut: false });
    });
  });
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function tail(text, lines = 12) {
  return (text ?? '').trim().split(/\n/).slice(-lines).join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(options.artifactDir, { recursive: true });

  const vaultEnv = options.vaultPath ? { OC_VAULT_PATH: options.vaultPath } : {};
  const commands = [
    {
      flow: 'boot',
      command: 'bash',
      args: ['scripts/check-freeze.sh', options.vault, String(options.freezeWait)],
      env: vaultEnv,
      summarize: (run) => summarizeScriptRun('boot', run),
    },
    {
      flow: 'reembed',
      command: 'bash',
      args: ['scripts/check-embed-speed.sh', String(options.embedBlocks), String(options.embedMaxTime)],
      env: { ...vaultEnv, OC_VAULT_NAME: options.vault },
      summarize: (run) => summarizeScriptRun('reembed', run),
    },
    {
      flow: 'lookup',
      command: 'bash',
      args: ['scripts/check-lookup.sh', options.vault, String(options.lookupTimeout)],
      env: vaultEnv,
      summarize: (run) => summarizeScriptRun('lookup', run),
    },
    {
      flow: 'block-import',
      command: 'bash',
      args: ['scripts/check-e2e.sh', options.vault, String(options.e2eMaxWait)],
      env: vaultEnv,
      summarize: (run) => summarizeScriptRun('block-import', run),
    },
    {
      flow: 'indexing',
      command: 'node',
      args: [
        'scripts/profile-scaling.mjs',
        `--vault=${options.vault}`,
        `--counts=${options.counts}`,
        `--artifact-dir=${options.artifactDir}/scaling`,
        ...(options.sourceVaultPath ? [`--source=${options.sourceVaultPath}`] : []),
        ...(options.testVaultPath ? [`--test-vault-path=${options.testVaultPath}`] : []),
      ],
      env: {},
      summarize: summarizeScalingRun,
    },
  ];

  const runs = [];
  for (const step of commands) {
    const runResult = await run(step.command, step.args, process.cwd(), step.env);
    runs.push({
      flow: step.flow,
      summary: step.summarize(runResult),
      stdoutTail: tail(runResult.stdout),
      stderrTail: tail(runResult.stderr),
    });
  }

  const ranking = rankFlowSummaries(runs.map((entry) => entry.summary));
  const artifact = {
    startedAt: new Date().toISOString(),
    options,
    ranking,
    runs: runs.map(({ flow, summary, stdoutTail, stderrTail }) => ({
      flow,
      summary,
      stdoutTail,
      stderrTail,
    })),
  };

  const artifactPath = resolve(options.artifactDir, `${stamp()}-freeze-flows.json`);
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  console.log(JSON.stringify({ artifactPath, ranking, flows: runs.map((entry) => entry.summary) }, null, 2));

  if (ranking[0]?.status !== 'passed') {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
