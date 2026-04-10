import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseEmbedRuntimeState } from '../src/types/embed-runtime';
import {
  beginEmbedProfilingStage,
  bumpEmbedProfilingCounter,
  createEmbedProfilingState,
  endEmbedProfilingStage,
  profileAsyncStage,
} from '../src/ui/embed-profiling-state';

function createPluginStub() {
  const plugin = {
    _embed_profiling: createEmbedProfilingState(),
    getEmbedProfilingState() {
      return {
        activeStage: this._embed_profiling.activeStage,
        activeSince: this._embed_profiling.activeSince,
        recentStages: this._embed_profiling.recentStages.map((stage: Record<string, unknown>) => ({ ...stage })),
        counters: { ...this._embed_profiling.counters },
      };
    },
  };

  return plugin as unknown as {
    _embed_profiling: ReturnType<typeof createEmbedProfilingState>;
    getEmbedProfilingState: () => ReturnType<typeof createEmbedProfilingState>;
  };
}

describe('embed profiling state', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('records completed stages with durations', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T01:00:00.000Z'));

    const plugin = createPluginStub();
    beginEmbedProfilingStage(plugin as never, 'init:core');
    vi.advanceTimersByTime(250);
    endEmbedProfilingStage(plugin as never, 'init:core');

    const profiling = plugin.getEmbedProfilingState();
    expect(profiling.activeStage).toBeNull();
    expect(profiling.recentStages).toHaveLength(1);
    expect(profiling.recentStages[0]).toMatchObject({
      name: 'init:core',
      durationMs: 250,
    });
  });

  it('increments counters and profiles async stages', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T01:00:00.000Z'));

    const plugin = createPluginStub();
    const work = profileAsyncStage(plugin as never, 'ui:connections-view:render', async () => {
      vi.advanceTimersByTime(125);
      return 'ok';
    });

    bumpEmbedProfilingCounter(plugin as never, 'connectionsViewRenderCount');
    await work;

    const profiling = plugin.getEmbedProfilingState();
    expect(profiling.counters.connectionsViewRenderCount).toBe(1);
    expect(profiling.recentStages[0]).toMatchObject({
      name: 'ui:connections-view:render',
      durationMs: 125,
    });
  });

  it('threads profiling through parsed runtime state', () => {
    const profiling = createEmbedProfilingState();
    profiling.counters.followupScheduledCount = 2;
    profiling.recentStages.push({
      name: 'embedding:followup-schedule',
      startedAt: 1,
      finishedAt: 11,
      durationMs: 10,
    });

    const runtime = parseEmbedRuntimeState(
      {
        phase: 'idle',
        modelFingerprint: 'openai:text-embedding-3-small:1536',
        lastError: null,
      },
      null,
      profiling,
    );

    expect(runtime.profiling.counters.followupScheduledCount).toBe(2);
    expect(runtime.profiling.recentStages[0]?.name).toBe('embedding:followup-schedule');
  });
});
