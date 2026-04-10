import type SmartConnectionsPlugin from '../main';
import type {
  EmbedProfilingCounters,
  EmbedProfilingStageName,
  EmbedProfilingState,
  EmbedStageMeasurement,
} from '../types/embed-runtime';

const MAX_RECENT_STAGES = 12;

function cloneCounters(counters: EmbedProfilingCounters): EmbedProfilingCounters {
  return { ...counters };
}

function cloneRecentStages(recentStages: EmbedStageMeasurement[]): EmbedStageMeasurement[] {
  return recentStages.map((stage) => ({ ...stage }));
}

export function createEmbedProfilingState(): EmbedProfilingState {
  return {
    activeStage: null,
    activeSince: null,
    recentStages: [],
    counters: {
      saveCount: 0,
      followupScheduledCount: 0,
      progressEventCount: 0,
      connectionsViewRenderCount: 0,
    },
  };
}

function publishProfilingState(
  plugin: SmartConnectionsPlugin,
  next: EmbedProfilingState,
): void {
  plugin._embed_profiling = {
    activeStage: next.activeStage,
    activeSince: next.activeSince,
    recentStages: cloneRecentStages(next.recentStages),
    counters: cloneCounters(next.counters),
  };
}

function readProfilingState(plugin: SmartConnectionsPlugin): EmbedProfilingState {
  const maybePlugin = plugin as SmartConnectionsPlugin & {
    getEmbedProfilingState?: () => EmbedProfilingState;
    _embed_profiling?: EmbedProfilingState;
  };

  if (typeof maybePlugin.getEmbedProfilingState === 'function') {
    return maybePlugin.getEmbedProfilingState();
  }
  return maybePlugin._embed_profiling
    ? {
      activeStage: maybePlugin._embed_profiling.activeStage,
      activeSince: maybePlugin._embed_profiling.activeSince,
      recentStages: cloneRecentStages(maybePlugin._embed_profiling.recentStages),
      counters: cloneCounters(maybePlugin._embed_profiling.counters),
    }
    : createEmbedProfilingState();
}

function finishActiveStage(state: EmbedProfilingState, finishedAt: number): void {
  if (!state.activeStage || !state.activeSince) return;
  const measurement: EmbedStageMeasurement = {
    name: state.activeStage,
    startedAt: state.activeSince,
    finishedAt,
    durationMs: Math.max(0, finishedAt - state.activeSince),
  };
  state.recentStages = [...state.recentStages, measurement].slice(-MAX_RECENT_STAGES);
  state.activeStage = null;
  state.activeSince = null;
}

export function beginEmbedProfilingStage(
  plugin: SmartConnectionsPlugin,
  stage: EmbedProfilingStageName,
  startedAt: number = Date.now(),
): void {
  const next = readProfilingState(plugin);
  if (next.activeStage === stage) return;
  finishActiveStage(next, startedAt);
  next.activeStage = stage;
  next.activeSince = startedAt;
  publishProfilingState(plugin, next);
}

export function endEmbedProfilingStage(
  plugin: SmartConnectionsPlugin,
  stage?: EmbedProfilingStageName,
  finishedAt: number = Date.now(),
): void {
  const next = readProfilingState(plugin);
  if (stage && next.activeStage !== stage) return;
  finishActiveStage(next, finishedAt);
  publishProfilingState(plugin, next);
}

export async function profileAsyncStage<T>(
  plugin: SmartConnectionsPlugin,
  stage: EmbedProfilingStageName,
  fn: () => Promise<T>,
): Promise<T> {
  beginEmbedProfilingStage(plugin, stage);
  try {
    return await fn();
  } finally {
    endEmbedProfilingStage(plugin, stage);
  }
}

export function bumpEmbedProfilingCounter(
  plugin: SmartConnectionsPlugin,
  counter: keyof EmbedProfilingCounters,
  amount = 1,
): void {
  const next = readProfilingState(plugin);
  next.counters[counter] += amount;
  publishProfilingState(plugin, next);
}
