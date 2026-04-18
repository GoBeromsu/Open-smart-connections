import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_ARTIFACT_DIR = resolve(process.cwd(), 'artifacts/live-vault-profiles');

function parseArgs(argv) {
  const options = {
    vault: 'Ataraxia',
    query: 'productivity',
    artifactDir: DEFAULT_ARTIFACT_DIR,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (const arg of argv) {
    const [key, value] = arg.split('=');
    if (key === '--vault' && value) options.vault = value;
    if (key === '--query' && value) options.query = value;
    if (key === '--artifact-dir' && value) options.artifactDir = resolve(value);
    if (key === '--timeout-ms' && value) options.timeoutMs = Number.parseInt(value, 10);
  }

  return options;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function runObsidian(vault, args, timeoutMs) {
  return new Promise((resolveRun) => {
    const startedAt = Date.now();
    const child = spawn('obsidian', [`vault=${vault}`, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolveRun({ code, signal, stdout, stderr, timedOut, durationMs: Date.now() - startedAt });
    });
  });
}

function parseEval(stdout) {
  const line = stdout.split('\n').map((value) => value.trim()).find((value) => value.startsWith('=> '));
  if (!line) return null;
  const payload = line.slice(3);
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(options.artifactDir, { recursive: true });

  const runtime = await runObsidian(options.vault, ['eval', `code=(function(){var p=app.plugins.plugins["open-connections"];return JSON.stringify({ready:!!p?.ready,embedReady:!!p?.embed_ready,noteCount:app.vault.getMarkdownFiles().length,sourceCount:p?.source_collection?.size??null,embeddedSourceCount:p?.source_collection?.embeddedCount??null,blockCount:p?.block_collection?.size??null,embeddedBlockCount:p?.block_collection?.embeddedCount??null,runtimeState:p?.getEmbedRuntimeState?.()??null,profilingState:p?.getEmbedProfilingState?.()??null,protoProps:p?Object.getOwnPropertyNames(Object.getPrototypeOf(p)).filter(function(k){return k.indexOf('Embed')>=0||k.indexOf('embed')>=0||k.indexOf('Runtime')>=0||k.indexOf('Profil')>=0;}):[],commandIds:Object.keys(app.commands.commands).filter(function(k){return k.indexOf('open-connections')>=0;}),leafCounts:{connections:app.workspace.getLeavesOfType('open-connections-view').length,lookup:app.workspace.getLeavesOfType('open-connections-lookup').length}});})()`], options.timeoutMs);

  const connectionsView = await runObsidian(options.vault, ['command', 'id=open-connections:connections-view'], options.timeoutMs);
  const lookupView = await runObsidian(options.vault, ['command', 'id=open-connections:open-lookup-view'], options.timeoutMs);
  const lookupSearch = await runObsidian(options.vault, ['eval', `code=(async function(){app.commands.executeCommandById("open-connections:open-lookup-view");await new Promise(function(resolve){setTimeout(resolve,250);});var leaf=app.workspace.getLeavesOfType("open-connections-lookup")[0];if(!leaf)return JSON.stringify({error:"lookup-view-missing"});var view=leaf.view;view.searchInput.value=${JSON.stringify(options.query)};view.performSearch(${JSON.stringify(options.query)});await new Promise(function(resolve){setTimeout(resolve,2000);});return JSON.stringify({query:${JSON.stringify(options.query)},resultCount:view.containerEl.querySelectorAll(".osc-lookup-result").length,leafCount:app.workspace.getLeavesOfType("open-connections-lookup").length});})()`], options.timeoutMs);

  const artifact = {
    startedAt: new Date().toISOString(),
    options,
    runtime: {
      ...runtime,
      parsed: parseEval(runtime.stdout),
    },
    connectionsView,
    lookupView,
    lookupSearch: {
      ...lookupSearch,
      parsed: parseEval(lookupSearch.stdout),
    },
  };

  const artifactPath = resolve(options.artifactDir, `${stamp()}-${options.vault.toLowerCase()}-live-profile.json`);
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  console.log(JSON.stringify({
    artifactPath,
    runtime: artifact.runtime.parsed,
    connectionsViewMs: connectionsView.durationMs,
    lookupViewMs: lookupView.durationMs,
    lookupSearch: artifact.lookupSearch.parsed,
  }, null, 2));

  if (runtime.timedOut || lookupSearch.timedOut) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
