import { describe, expect, it } from 'vitest';

import {
  classifyScriptRun,
  rankFlowSummaries,
  summarizeScalingRun,
  summarizeScriptRun,
} from '../scripts/profile-flow-report.mjs';

describe('profile flow report helpers', () => {
  it('classifies freeze output ahead of generic failure', () => {
    expect(classifyScriptRun('FREEZE_DETECTED\nRESULT: FAIL', '', 1)).toBe('freeze_detected');
    expect(classifyScriptRun('RESULT: PASS', '', 0)).toBe('passed');
    expect(classifyScriptRun('RESULT: PARTIAL', '', 1)).toBe('partial');
  });

  it('extracts script summary fields from stdout', () => {
    const summary = summarizeScriptRun('reembed', {
      stdout: 'Completed in 18s\nAdapter: local-transformers\nChecks: 3/3 passed\nRESULT: PASS',
      stderr: '',
      code: 0,
      durationMs: 18123,
      timedOut: false,
    });

    expect(summary).toMatchObject({
      flow: 'reembed',
      status: 'passed',
      elapsedSeconds: 18,
      adapter: 'local-transformers',
      checks: 3,
    });
  });

  it('summarizes scaling output from the final JSON block', () => {
    const run = {
      stdout: [
        'noise',
        JSON.stringify({
          artifactPath: 'artifacts/scaling.json',
          batches: [
            { status: 'passed', timing: { connectionsView: { meanMs: 120 } } },
            { status: 'failed', timing: { connectionsView: { meanMs: 240 } } },
          ],
        }, null, 2),
      ].join('\n'),
      stderr: '',
      code: 1,
      durationMs: 5000,
      timedOut: false,
    };

    expect(summarizeScalingRun(run)).toMatchObject({
      flow: 'indexing',
      status: 'failed',
      artifactPath: 'artifacts/scaling.json',
      batchCount: 2,
      failedBatches: 1,
      slowestConnectionsViewMs: 240,
    });
  });

  it('ranks worse status ahead of slower passing runs', () => {
    const ranked = rankFlowSummaries([
      { flow: 'lookup', status: 'passed', severity: 1, commandDurationMs: 9000, elapsedSeconds: 9 },
      { flow: 'boot', status: 'freeze_detected', severity: 4, commandDurationMs: 3000, elapsedSeconds: 3 },
      { flow: 'reembed', status: 'failed', severity: 3, commandDurationMs: 11000, elapsedSeconds: 11 },
    ]);

    expect(ranked.map((item) => item.flow)).toEqual(['boot', 'reembed', 'lookup']);
  });
});
