import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

import { summarizeLatencyState } from './profile-state-latency-report.mjs';

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_POLL_TIMEOUT_MS = 20_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 90_000;
const DEFAULT_ARTIFACT_DIR = resolve(process.cwd(), 'artifacts/state-latency');

const STATE_DEFS = {
  startupCore: {
    id: 'startup-core',
    label: 'startup core init',
    codePath: ['src/ui/plugin-initialization.ts:61-113'],
  },
  startupEmbedding: {
    id: 'startup-embedding-init',
    label: 'startup embedding init',
    codePath: ['src/ui/plugin-initialization.ts:116-188'],
  },
  startupBackgroundImport: {
    id: 'startup-background-import',
    label: 'startup background import',
    codePath: ['src/ui/plugin-initialization.ts:154-179', 'src/ui/collection-block-import.ts:22-83'],
  },
  newNote: {
    id: 'new-note-debounce-reimport',
    label: 'new-note debounce/re-import latency',
    codePath: ['src/domain/config.ts:56-63', 'src/ui/file-watcher.ts:79-163'],
  },
  noteSwitchIndexed: {
    id: 'note-switch-indexed',
    label: 'note-switch to already-indexed note',
    codePath: ['src/ui/ConnectionsView.ts:114-146', 'src/ui/connections-view-state.ts:21-49'],
  },
  noteSwitchUnindexed: {
    id: 'note-switch-unindexed',
    label: 'note-switch to note with no blocks yet',
    codePath: [
      'src/ui/ConnectionsView.ts:114-146',
      'src/ui/connections-view-state.ts:29-38',
      'src/domain/entities/BlockCollection.ts:85-117',
      'src/domain/entities/markdown-splitter.ts:23-76',
    ],
  },
  activeLeafDebounce: {
    id: 'active-leaf-debounce',
    label: 'active-leaf-change debounce latency',
    codePath: ['src/ui/file-watcher.ts:62-66', 'src/ui/file-watcher.ts:91-101'],
  },
  lookupOpen: {
    id: 'lookup-open',
    label: 'lookup view open latency',
    codePath: ['src/ui/LookupView.ts:53-115'],
  },
  lookupFirstQuery: {
    id: 'lookup-first-query',
    label: 'lookup first-query latency',
    codePath: ['src/ui/LookupView.ts:119-154'],
  },
};

function parseArgs(argv) {
  const options = {
    vault: 'Ataraxia',
    query: 'productivity',
    samples: 3,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    pollTimeoutMs: DEFAULT_POLL_TIMEOUT_MS,
    startupTimeoutMs: DEFAULT_STARTUP_TIMEOUT_MS,
    artifactDir: DEFAULT_ARTIFACT_DIR,
  };

  for (const arg of argv) {
    const [key, value] = arg.split('=');
    if (key === '--vault' && value) options.vault = value;
    if (key === '--query' && value) options.query = value;
    if (key === '--samples' && value) options.samples = Number.parseInt(value, 10);
    if (key === '--timeout-ms' && value) options.timeoutMs = Number.parseInt(value, 10);
    if (key === '--poll-interval-ms' && value) options.pollIntervalMs = Number.parseInt(value, 10);
    if (key === '--poll-timeout-ms' && value) options.pollTimeoutMs = Number.parseInt(value, 10);
    if (key === '--startup-timeout-ms' && value) options.startupTimeoutMs = Number.parseInt(value, 10);
    if (key === '--artifact-dir' && value) options.artifactDir = resolve(value);
  }

  return options;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      resolveRun({
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

function parseEval(stdout) {
  const line = stdout
    .split('\n')
    .map((value) => value.trim())
    .find((value) => value.startsWith('=> '));
  if (!line) return null;
  const payload = line.slice(3);
  try {
    return JSON.parse(payload);
  } catch {
    return payload || null;
  }
}

async function evalJson(vault, code, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const result = await runObsidian(vault, ['eval', `code=${code}`], timeoutMs);
  const parsed = result.timedOut ? null : parseEval(result.stdout);
  const emptyOutput = !result.timedOut
    && (result.code ?? 0) === 0
    && ((result.stdout ?? '').trim().length === 0 || parsed === null);

  return {
    ...result,
    parsed,
    emptyOutput,
  };
}

function jsString(value) {
  return JSON.stringify(value);
}

async function ensureConnectionsView(vault, timeoutMs) {
  await runObsidian(vault, ['command', 'id=open-connections:connections-view'], timeoutMs);
  await evalJson(
    vault,
    `(async()=>{const leaf=app.workspace.getLeavesOfType("open-connections-view")[0]; if(leaf){ await app.workspace.revealLeaf(leaf); } return JSON.stringify({revealed:!!leaf});})()`,
    timeoutMs,
  );
  await sleep(300);
}

async function ensureLookupView(vault, timeoutMs) {
  await runObsidian(vault, ['command', 'id=open-connections:open-lookup-view'], timeoutMs);
  await sleep(300);
}

async function closeLeavesOfType(vault, type, timeoutMs) {
  await evalJson(
    vault,
    `(async()=>{for (const leaf of app.workspace.getLeavesOfType(${jsString(type)})) { await leaf.detach(); } return JSON.stringify({closed:${jsString(type)}});})()`,
    timeoutMs,
  );
}

async function getCandidateNotes(vault, sampleCount, timeoutMs) {
  const code = `(() => {
    const plugin = app.plugins.plugins["open-connections"];
    const sourceIndex = plugin?.block_collection?._sourceIndex;
    const activeFile = app.workspace.getActiveFile()?.path ?? null;
    const indexed = [];
    for (const [sourceKey, blockKeys] of sourceIndex?.entries?.() ?? []) {
      let embedded = false;
      for (const blockKey of blockKeys ?? []) {
        const block = plugin?.block_collection?.items?.[blockKey];
        if (block?.has_embed?.()) {
          embedded = true;
          break;
        }
      }
      if (!embedded) continue;
      indexed.push(sourceKey);
      if (indexed.length >= ${sampleCount * 3}) break;
    }

    return JSON.stringify({ activeFile, indexed });
  })()`;

  const result = await evalJson(vault, code, timeoutMs);
  if (!result.parsed || typeof result.parsed !== 'object') {
    throw new Error('Failed to discover candidate notes for latency profiling.');
  }
  return result.parsed;
}

async function pollScenario({ vault, timeoutMs, pollIntervalMs, pollCodeFactory, stopWhen }) {
  const startedAt = Date.now();
  const trace = [];
  let emptyPollCount = 0;
  let timeoutCount = 0;

  while (Date.now() - startedAt < timeoutMs) {
    const elapsedMs = Date.now() - startedAt;
    const pollResult = await evalJson(vault, pollCodeFactory(), Math.min(DEFAULT_TIMEOUT_MS, pollIntervalMs + 1_000));
    const entry = {
      elapsedMs,
      durationMs: pollResult.durationMs,
      timedOut: pollResult.timedOut,
      emptyOutput: pollResult.emptyOutput,
      parsed: pollResult.parsed,
    };
    if (pollResult.timedOut) timeoutCount += 1;
    if (pollResult.emptyOutput) emptyPollCount += 1;
    trace.push(entry);

    if (stopWhen(entry)) {
      return { trace, timeoutCount, emptyPollCount, completed: true };
    }

    await sleep(pollIntervalMs);
  }

  return { trace, timeoutCount, emptyPollCount, completed: false };
}

function firstMatchingElapsed(trace, predicate) {
  const match = trace.find((entry) => !entry.timedOut && !entry.emptyOutput && predicate(entry.parsed));
  return match ? match.elapsedMs : null;
}

async function captureStartupStages(vault, options) {
  await runObsidian(vault, ['plugin:reload', 'id=open-connections'], options.timeoutMs);

  const pollResult = await pollScenario({
    vault,
    timeoutMs: options.startupTimeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    pollCodeFactory: () => `(() => {
      const plugin = app.plugins.plugins["open-connections"];
      const runtime = plugin?.getEmbedRuntimeState?.();
      const profiling = runtime?.profiling ?? plugin?.getEmbedProfilingState?.() ?? null;
      return JSON.stringify({
        ready: !!plugin?.ready,
        embedReady: !!plugin?.embed_ready,
        phase: plugin?._embed_state?.phase ?? null,
        activeStage: profiling?.activeStage ?? null,
        recentStages: profiling?.recentStages ?? [],
      });
    })()`,
    stopWhen: (entry) => {
      const parsed = entry.parsed;
      if (!parsed || typeof parsed !== 'object') return false;
      const recent = Array.isArray(parsed.recentStages) ? parsed.recentStages : [];
      return parsed.ready && recent.some((stage) => stage?.name === 'init:background-import') && !parsed.activeStage;
    },
  });

  const lastParsed = [...pollResult.trace].reverse().find((entry) => entry.parsed && typeof entry.parsed === 'object')?.parsed ?? {};
  const recentStages = Array.isArray(lastParsed.recentStages) ? lastParsed.recentStages : [];
  const findStage = (name) => recentStages.find((stage) => stage?.name === name) ?? null;

  return {
    raw: pollResult,
    states: [
      {
        ...STATE_DEFS.startupCore,
        sampleCount: 1,
        samples: [{
          primaryDurationMs: findStage('init:core')?.durationMs ?? null,
          timeoutCount: pollResult.timeoutCount,
          emptyPollCount: pollResult.emptyPollCount,
          freezeDetected: pollResult.timeoutCount > 0 || pollResult.emptyPollCount > 0,
          trace: pollResult.trace,
        }],
      },
      {
        ...STATE_DEFS.startupEmbedding,
        sampleCount: 1,
        samples: [{
          primaryDurationMs: findStage('init:embedding')?.durationMs ?? null,
          timeoutCount: pollResult.timeoutCount,
          emptyPollCount: pollResult.emptyPollCount,
          freezeDetected: pollResult.timeoutCount > 0 || pollResult.emptyPollCount > 0,
          trace: pollResult.trace,
        }],
      },
      {
        ...STATE_DEFS.startupBackgroundImport,
        sampleCount: 1,
        samples: [{
          primaryDurationMs: findStage('init:background-import')?.durationMs ?? null,
          timeoutCount: pollResult.timeoutCount,
          emptyPollCount: pollResult.emptyPollCount,
          freezeDetected: pollResult.timeoutCount > 0 || pollResult.emptyPollCount > 0,
          trace: pollResult.trace,
        }],
      },
    ],
  };
}

async function sampleNewNote(vault, options, sampleIndex) {
  const notePath = `oc-state-latency-note-${Date.now()}-${sampleIndex}.md`;
  const noteContent = [
    '# State latency sample',
    '',
    'This temporary note exists to measure debounce, source import, block import, and embedding latency.',
    '',
    'productivity obsidian semantic search embeddings background import connections view.',
  ].join('\n');

  const createCode = `(async()=>{const path=${jsString(notePath)}; const content=${jsString(noteContent)}; const existing=app.vault.getAbstractFileByPath(path); if(existing){await app.vault.delete(existing,true);} await app.vault.create(path, content); return JSON.stringify({path});})()`;
  await evalJson(vault, createCode, options.timeoutMs);

  const pollResult = await pollScenario({
    vault,
    timeoutMs: options.pollTimeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    pollCodeFactory: () => `(() => {
      const path = ${jsString(notePath)};
      const plugin = app.plugins.plugins["open-connections"];
      const source = plugin?.source_collection?.get?.(path) ?? null;
      const blocks = plugin?.block_collection?.for_source?.(path) ?? [];
      const embeddedBlockCount = blocks.filter((block) => block?.has_embed?.()).length;
      return JSON.stringify({
        path,
        sourceExists: !!source,
        blockCount: blocks.length,
        embeddedBlockCount,
        pendingReimport: plugin?.pendingReImportPaths?.has?.(path) ?? false,
        reImportScheduled: !!plugin?.re_import_timeout,
        phase: plugin?._embed_state?.phase ?? null,
        activeStage: plugin?.getEmbedProfilingState?.()?.activeStage ?? null,
        lastError: plugin?._embed_state?.lastError ?? null,
      });
    })()`,
    stopWhen: (entry) => {
      const parsed = entry.parsed;
      return !!parsed && parsed.embeddedBlockCount > 0 && !parsed.pendingReimport;
    },
  });

  const sourceImportedMs = firstMatchingElapsed(pollResult.trace, (parsed) => parsed?.sourceExists);
  const blockImportedMs = firstMatchingElapsed(pollResult.trace, (parsed) => (parsed?.blockCount ?? 0) > 0);
  const embeddedMs = firstMatchingElapsed(pollResult.trace, (parsed) => (parsed?.embeddedBlockCount ?? 0) > 0);
  const pendingClearedMs = firstMatchingElapsed(pollResult.trace, (parsed) => parsed && parsed.pendingReimport === false && parsed.sourceExists);

  const cleanupCode = `(async()=>{const path=${jsString(notePath)}; const file=app.vault.getAbstractFileByPath(path); if(file){await app.vault.delete(file,true);} return "deleted";})()`;
  await evalJson(vault, cleanupCode, options.timeoutMs);

  return {
    primaryDurationMs: sourceImportedMs ?? embeddedMs ?? options.pollTimeoutMs,
    completedMs: embeddedMs,
    sourceImportedMs,
    blockImportedMs,
    pendingClearedMs,
    timeoutCount: pollResult.timeoutCount,
    emptyPollCount: pollResult.emptyPollCount,
    freezeDetected: pollResult.timeoutCount > 0 || pollResult.emptyPollCount > 0,
    trace: pollResult.trace,
  };
}

async function sampleNoteSwitch(vault, options, targetPath) {
  await ensureConnectionsView(vault, options.timeoutMs);
  const switchCode = `(async()=>{const path=${jsString(targetPath)}; const file=app.vault.getAbstractFileByPath(path); if(!file){return JSON.stringify({error:"missing-file", path});} const leaf=app.workspace.getMostRecentLeaf?.() ?? app.workspace.getLeaf(false); await leaf.openFile(file); const connLeaf=app.workspace.getLeavesOfType("open-connections-view")[0]; if(connLeaf){ await app.workspace.revealLeaf(connLeaf); await connLeaf.view.renderView(path); } return JSON.stringify({path, rendered:!!connLeaf});})()`;
  const trigger = await evalJson(vault, switchCode, options.timeoutMs);

  const pollResult = await pollScenario({
    vault,
    timeoutMs: options.pollTimeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    pollCodeFactory: () => `(() => {
      const path = ${jsString(targetPath)};
      const plugin = app.plugins.plugins["open-connections"];
      const leaf = app.workspace.getLeavesOfType("open-connections-view")[0];
      const view = leaf?.view;
      const text = (view?.containerEl?.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 400);
      const loading = /Importing note|Embedding this note|Open Connections is loading|Loading/.test(text);
      const resultsCount = view?.containerEl?.querySelectorAll?.("[role=listitem]")?.length ?? 0;
      return JSON.stringify({
        activeFile: app.workspace.getActiveFile()?.path ?? null,
        targetPath: path,
        lastRenderedPath: view?.lastRenderedPath ?? null,
        loading,
        text,
        resultsCount,
        phase: plugin?._embed_state?.phase ?? null,
        activeStage: plugin?.getEmbedProfilingState?.()?.activeStage ?? null,
        pendingReimport: plugin?.pendingReImportPaths?.has?.(path) ?? false,
        reImportScheduled: !!plugin?.re_import_timeout,
      });
    })()`,
    stopWhen: (entry) => {
      const parsed = entry.parsed;
      return !!parsed
        && parsed.activeFile === targetPath
        && parsed.lastRenderedPath === targetPath
        && !parsed.loading;
    },
  });

  const firstResponsiveMs = firstMatchingElapsed(pollResult.trace, () => true);
  const viewSettledMs = firstMatchingElapsed(
    pollResult.trace,
    (parsed) => parsed?.activeFile === targetPath && parsed?.lastRenderedPath === targetPath && !parsed?.loading,
  );
  const backgroundDoneMs = firstMatchingElapsed(
    pollResult.trace,
    (parsed) => parsed?.activeFile === targetPath && parsed?.lastRenderedPath === targetPath && !parsed?.loading && parsed?.phase === 'idle' && !parsed?.activeStage,
  );

  return {
    primaryDurationMs: trigger.durationMs + (viewSettledMs ?? options.pollTimeoutMs),
    triggerDurationMs: trigger.durationMs,
    firstResponsiveMs: firstResponsiveMs === null ? null : trigger.durationMs + firstResponsiveMs,
    viewSettledMs: viewSettledMs === null ? null : trigger.durationMs + viewSettledMs,
    backgroundDoneMs: backgroundDoneMs === null ? null : trigger.durationMs + backgroundDoneMs,
    timeoutCount: pollResult.timeoutCount + (trigger.timedOut ? 1 : 0),
    emptyPollCount: pollResult.emptyPollCount + (trigger.emptyOutput ? 1 : 0),
    freezeDetected: pollResult.timeoutCount > 0 || pollResult.emptyPollCount > 0 || trigger.timedOut || trigger.emptyOutput,
    trace: pollResult.trace,
  };
}

async function sampleActiveLeafDebounce(vault, options, targetPath) {
  await ensureConnectionsView(vault, options.timeoutMs);
  const switchCode = `(async()=>{const path=${jsString(targetPath)}; const file=app.vault.getAbstractFileByPath(path); if(!file){return JSON.stringify({error:"missing-file", path});} const leaf=app.workspace.getMostRecentLeaf?.() ?? app.workspace.getLeaf(false); await leaf.openFile(file); return JSON.stringify({path});})()`;
  await evalJson(vault, switchCode, options.timeoutMs);

  let scheduledSeen = false;
  const pollResult = await pollScenario({
    vault,
    timeoutMs: Math.max(options.pollTimeoutMs, 18_000),
    pollIntervalMs: options.pollIntervalMs,
    pollCodeFactory: () => `(() => {
      const plugin = app.plugins.plugins["open-connections"];
      return JSON.stringify({
        activeFile: app.workspace.getActiveFile()?.path ?? null,
        targetPath: ${jsString(targetPath)},
        reImportScheduled: !!plugin?.re_import_timeout,
        pendingCount: plugin?.pendingReImportPaths?.size ?? 0,
        configuredWaitMs: (plugin?.settings?.re_import_wait_time ?? 13) * 1000,
        phase: plugin?._embed_state?.phase ?? null,
      });
    })()`,
    stopWhen: (entry) => {
      const parsed = entry.parsed;
      if (parsed?.reImportScheduled) scheduledSeen = true;
      return !!parsed && scheduledSeen && parsed.activeFile === targetPath && parsed.reImportScheduled === false && parsed.pendingCount === 0;
    },
  });

  const scheduledMs = firstMatchingElapsed(pollResult.trace, (parsed) => parsed?.reImportScheduled === true);
  const clearedMs = firstMatchingElapsed(pollResult.trace, (parsed) => parsed?.activeFile === targetPath && parsed?.reImportScheduled === false && parsed?.pendingCount === 0);
  const configuredWaitMs = pollResult.trace.find((entry) => entry.parsed?.configuredWaitMs)?.parsed?.configuredWaitMs ?? 13_000;

  return {
    primaryDurationMs: clearedMs ?? configuredWaitMs,
    scheduledMs,
    clearedMs,
    configuredWaitMs,
    timeoutCount: pollResult.timeoutCount,
    emptyPollCount: pollResult.emptyPollCount,
    freezeDetected: pollResult.timeoutCount > 0 || pollResult.emptyPollCount > 0,
    trace: pollResult.trace,
  };
}

async function sampleLookupOpen(vault, options) {
  await closeLeavesOfType(vault, 'open-connections-lookup', options.timeoutMs);
  const trigger = await runObsidian(vault, ['command', 'id=open-connections:open-lookup-view'], options.timeoutMs);
  await evalJson(
    vault,
    `(async()=>{const leaf=app.workspace.getLeavesOfType("open-connections-lookup")[0]; if(leaf){ await app.workspace.revealLeaf(leaf); } return JSON.stringify({revealed:!!leaf});})()`,
    options.timeoutMs,
  );
  await sleep(300);
  const pollResult = await pollScenario({
    vault,
    timeoutMs: options.pollTimeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    pollCodeFactory: () => `(() => JSON.stringify({
      leafCount: app.workspace.getLeavesOfType("open-connections-lookup").length
    }))()`,
    stopWhen: (entry) => !!entry.parsed && (entry.parsed.leafCount ?? 0) > 0,
  });

  return {
    primaryDurationMs: trigger.durationMs + (firstMatchingElapsed(pollResult.trace, (parsed) => (parsed?.leafCount ?? 0) > 0) ?? options.pollTimeoutMs),
    triggerDurationMs: trigger.durationMs,
    timeoutCount: pollResult.timeoutCount + (trigger.timedOut ? 1 : 0),
    emptyPollCount: pollResult.emptyPollCount,
    freezeDetected: pollResult.timeoutCount > 0 || pollResult.emptyPollCount > 0 || trigger.timedOut,
    trace: pollResult.trace,
  };
}

async function sampleLookupQuery(vault, options) {
  await closeLeavesOfType(vault, 'open-connections-lookup', options.timeoutMs);
  await ensureLookupView(vault, options.timeoutMs);
  const query = options.query;
  const searchCode = `(async()=>{const leaf=app.workspace.getLeavesOfType("open-connections-lookup")[0]; if(!leaf)return JSON.stringify({error:"lookup-view-missing"}); const view=leaf.view; view.searchInput.value=${jsString(query)}; view.performSearch(${jsString(query)}); return JSON.stringify({query:${jsString(query)}});})()`;
  const trigger = await evalJson(vault, searchCode, options.timeoutMs);

  const pollResult = await pollScenario({
    vault,
    timeoutMs: options.pollTimeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    pollCodeFactory: () => `(() => {
      const leaf = app.workspace.getLeavesOfType("open-connections-lookup")[0];
      const view = leaf?.view;
      const text = (view?.containerEl?.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 400);
      const resultsCount = view?.containerEl?.querySelectorAll?.(".osc-lookup-result")?.length ?? 0;
      const loading = /Loading|Searching/.test(text);
      return JSON.stringify({ resultsCount, loading, text });
    })()`,
    stopWhen: (entry) => !!entry.parsed && ((entry.parsed.resultsCount ?? 0) > 0 || (entry.parsed.loading === false && entry.parsed.text.length > 0)),
  });

  const lookupSettledMs = firstMatchingElapsed(
    pollResult.trace,
    (parsed) => (parsed?.resultsCount ?? 0) > 0 || (parsed?.loading === false && (parsed?.text ?? '').length > 0),
  );

  return {
    primaryDurationMs: trigger.durationMs + (lookupSettledMs ?? options.pollTimeoutMs),
    triggerDurationMs: trigger.durationMs,
    lookupSettledMs: lookupSettledMs === null ? null : trigger.durationMs + lookupSettledMs,
    timeoutCount: pollResult.timeoutCount + (trigger.timedOut ? 1 : 0),
    emptyPollCount: pollResult.emptyPollCount + (trigger.emptyOutput ? 1 : 0),
    freezeDetected: pollResult.timeoutCount > 0 || pollResult.emptyPollCount > 0 || trigger.timedOut || trigger.emptyOutput,
    trace: pollResult.trace,
  };
}

async function sampleSyntheticUnindexedNote(vault, options, sampleIndex) {
  const notePath = `oc-state-latency-unindexed-${Date.now()}-${sampleIndex}.md`;
  const noteContent = [
    '# Unindexed latency sample',
    '',
    'This temporary note is intentionally imported as a source without blocks so that Connections View must perform the first block import on demand.',
    '',
    '## Section A',
    'This section contains enough content to create a heading block and paragraph blocks during parsing. productivity obsidian semantic search embeddings background import connections view.',
    '',
    '## Section B',
    'More content here so the parser, hashing work, and data adapter save are all exercised when the note is opened through Connections View.',
  ].join('\n');

  const primeCode = `(async()=>{const path=${jsString(notePath)}; const content=${jsString(noteContent)}; const plugin=app.plugins.plugins["open-connections"]; const existing=app.vault.getAbstractFileByPath(path); if(existing){await app.vault.delete(existing,true);} await app.vault.create(path, content); const file=app.vault.getAbstractFileByPath(path); const prev=plugin.source_collection._initializing; plugin.source_collection._initializing = true; try { await plugin.source_collection.import_source(file); await plugin.source_collection.data_adapter.save(); } finally { plugin.source_collection._initializing = prev; } plugin.pendingReImportPaths.delete(path); const blocks=plugin.block_collection.for_source(path); return JSON.stringify({path, sourceExists: !!plugin.source_collection.get(path), blockCount: blocks.length});})()`;
  const primed = await evalJson(vault, primeCode, options.timeoutMs);
  if (!primed.parsed?.sourceExists || primed.parsed?.blockCount !== 0) {
    throw new Error('Failed to prime a synthetic unindexed note for state-latency profiling.');
  }

  const sample = await sampleNoteSwitch(vault, options, notePath);

  const cleanupCode = `(async()=>{const path=${jsString(notePath)}; const plugin=app.plugins.plugins["open-connections"]; plugin.pendingReImportPaths.delete(path); plugin.block_collection?.delete_source_blocks?.(path); plugin.source_collection?.delete?.(path); const file=app.vault.getAbstractFileByPath(path); if(file){await app.vault.delete(file,true);} return JSON.stringify({deleted:path});})()`;
  await evalJson(vault, cleanupCode, options.timeoutMs);

  return sample;
}

function summarizeRepeated(state, samples) {
  return summarizeLatencyState(state, samples.map((sample) => ({
    ...sample,
  })));
}

function buildMarkdownReport(summary) {
  const lines = [
    '# Ataraxia State Latency Report',
    '',
    `- Generated: ${summary.generatedAt}`,
    `- Vault: ${summary.options.vault}`,
    `- Samples per repeated interactive state: ${summary.options.samples}`,
    '',
    '| State | Samples | Median / Worst | Trigger median | Impact | Empty / Timeout polls | Code path | What it means |',
    '|---|---:|---:|---:|---|---:|---|---|',
  ];

  for (const state of summary.states) {
    const stats = `${state.medianMs ?? 'n/a'} / ${state.worstCaseMs ?? 'n/a'} ms`;
    const triggerStats = state.triggerMedianMs === null ? 'n/a' : `${state.triggerMedianMs} ms`;
    lines.push(`| ${state.label} | ${state.sampleCount} | ${stats} | ${triggerStats} | ${state.impact} | ${state.emptyPollCount} / ${state.timeoutCount} | ${state.codePath.join('<br>')} | ${state.explanation} |`);
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(options.artifactDir, { recursive: true });

  const candidates = await getCandidateNotes(options.vault, options.samples, Math.max(options.timeoutMs, 15_000));
  const indexedCandidates = (candidates.indexed ?? []).filter((path) => path !== candidates.activeFile);
  const fallbackIndexedCandidates = indexedCandidates.length > 0 ? indexedCandidates : (candidates.indexed ?? []);

  if (fallbackIndexedCandidates.length === 0) {
    throw new Error('No indexed-note candidates available for state-latency profiling.');
  }
  const startup = await captureStartupStages(options.vault, options);
  const newNoteSamples = [];
  const indexedSamples = [];
  const unindexedSamples = [];
  const activeLeafSamples = [];
  const lookupOpenSamples = [];
  const lookupQuerySamples = [];

  for (let index = 0; index < options.samples; index += 1) {
    newNoteSamples.push(await sampleNewNote(options.vault, options, index));
    indexedSamples.push(await sampleNoteSwitch(options.vault, options, fallbackIndexedCandidates[index % fallbackIndexedCandidates.length]));
    unindexedSamples.push(await sampleSyntheticUnindexedNote(options.vault, options, index));
    activeLeafSamples.push(await sampleActiveLeafDebounce(options.vault, options, fallbackIndexedCandidates[index % fallbackIndexedCandidates.length]));
    lookupOpenSamples.push(await sampleLookupOpen(options.vault, options));
    lookupQuerySamples.push(await sampleLookupQuery(options.vault, options));
  }

  const states = [
    summarizeLatencyState(STATE_DEFS.startupCore, startup.states[0].samples),
    summarizeLatencyState(STATE_DEFS.startupEmbedding, startup.states[1].samples),
    summarizeLatencyState(STATE_DEFS.startupBackgroundImport, startup.states[2].samples),
    summarizeRepeated(STATE_DEFS.newNote, newNoteSamples),
    summarizeRepeated(STATE_DEFS.noteSwitchIndexed, indexedSamples),
    summarizeRepeated(STATE_DEFS.noteSwitchUnindexed, unindexedSamples),
    summarizeRepeated(STATE_DEFS.activeLeafDebounce, activeLeafSamples),
    summarizeRepeated(STATE_DEFS.lookupOpen, lookupOpenSamples),
    summarizeRepeated(STATE_DEFS.lookupFirstQuery, lookupQuerySamples),
  ];

  const summary = {
    generatedAt: nowIso(),
    options,
    candidates,
    states,
    raw: {
      startup: startup.raw,
      newNoteSamples,
      indexedSamples,
      unindexedSamples,
      activeLeafSamples,
      lookupOpenSamples,
      lookupQuerySamples,
    },
  };

  const artifactBase = resolve(options.artifactDir, `${stamp()}-state-latency`);
  const jsonPath = `${artifactBase}.json`;
  const mdPath = `${artifactBase}.md`;
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
  writeFileSync(mdPath, buildMarkdownReport(summary));

  console.log(JSON.stringify({
    jsonPath,
    mdPath,
    states: states.map((state) => ({
      id: state.id,
      medianMs: state.medianMs,
      worstCaseMs: state.worstCaseMs,
      impact: state.impact,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
