import { describe, expect, it } from 'vitest';

import {
  percentile,
  classifyLatencyImpact,
  summarizeLatencyState,
} from '../scripts/profile-state-latency-report.mjs';

describe('profile-state-latency-report helpers', () => {
  it('computes percentiles from ordered and unordered values', () => {
    expect(percentile([3, 1, 2], 0.5)).toBe(2);
    expect(percentile([100, 10, 50, 30], 0.95)).toBeGreaterThan(50);
  });

  it('classifies interactive failures as blockers', () => {
    expect(classifyLatencyImpact('note-switch-unindexed', [
      { primaryDurationMs: 1200, timeoutCount: 1, emptyPollCount: 0, freezeDetected: false },
    ])).toBe('interactive-blocker');
  });

  it('keeps debounce/background states as background when polls stay responsive', () => {
    expect(classifyLatencyImpact('new-note-debounce-reimport', [
      { primaryDurationMs: 11_000, timeoutCount: 0, emptyPollCount: 0, freezeDetected: false },
    ])).toBe('background');
  });

  it('summarizes repeated samples with median and worst-case', () => {
    const summary = summarizeLatencyState(
      {
        id: 'note-switch-indexed',
        label: 'note-switch indexed',
        codePath: ['src/ui/ConnectionsView.ts', 'src/ui/connections-view-state.ts'],
      },
      [
        { primaryDurationMs: 120, timeoutCount: 0, emptyPollCount: 0, freezeDetected: false },
        { primaryDurationMs: 180, timeoutCount: 0, emptyPollCount: 0, freezeDetected: false },
        { primaryDurationMs: 160, timeoutCount: 0, emptyPollCount: 0, freezeDetected: false },
      ],
    );

    expect(summary).toMatchObject({
      id: 'note-switch-indexed',
      sampleCount: 3,
      medianMs: 160,
      worstCaseMs: 180,
      impact: 'background',
    });
    expect(summary.explanation).toContain('best-case note-switch path');
  });
});
