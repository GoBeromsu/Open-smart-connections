const INTERACTIVE_SETTLE_MS = 1_000;

function round(value) {
  return Number(value.toFixed(1));
}

export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function classifyLatencyImpact(stateId, sampleMetrics) {
  const hasTimeoutFailure = sampleMetrics.some((sample) => sample.timeoutCount > 0);
  const hasEmptyPolls = sampleMetrics.some((sample) => sample.emptyPollCount > 0);

  if (stateId === 'startup-core' || stateId === 'startup-embedding-init') {
    if (hasTimeoutFailure) return 'interactive-blocker';
    return hasEmptyPolls ? 'responsive-but-degraded' : 'background';
  }

  if (stateId === 'startup-background-import' || stateId === 'new-note-debounce-reimport' || stateId === 'active-leaf-debounce') {
    if (hasTimeoutFailure) return 'interactive-blocker';
    return 'background';
  }

  if (hasTimeoutFailure || hasEmptyPolls) return 'interactive-blocker';

  const settledValues = sampleMetrics
    .map((sample) => sample.viewSettledMs ?? sample.lookupSettledMs ?? sample.sourceImportedMs ?? sample.completedMs ?? sample.primaryDurationMs)
    .filter((value) => Number.isFinite(value));

  if (settledValues.length === 0) return 'responsive-but-degraded';

  return settledValues.some((value) => value > INTERACTIVE_SETTLE_MS)
    ? 'responsive-but-degraded'
    : 'background';
}

export function buildExplanation(state, summary) {
  const median = summary.medianMs ?? 'n/a';

  switch (state.id) {
    case 'startup-core':
      return `Startup core init is a reload/startup-only cost (${median}ms median), not a note-switch blocker unless CLI responsiveness also drops.`;
    case 'startup-embedding-init':
      return `Embedding init is a startup-only warmup cost (${median}ms median); it matters for startup readiness more than interactive note switching.`;
    case 'startup-background-import':
      return `Background import continues after startup and took ${median}ms median here; it is background work unless polls show CLI/UI responsiveness loss.`;
    case 'new-note-debounce-reimport':
      return `This latency is mostly the fixed debounce/re-import wait before the new note is imported; current evidence should reveal whether it stays background-only or leaks into interaction.`;
    case 'note-switch-indexed':
      return `This is the best-case note-switch path, reported as an end-to-end proxy from note-switch trigger plus CLI/view settle; if it stays high, ordinary note switching itself is a UX problem.`;
    case 'note-switch-unindexed':
      return `This is the key suspect path, reported as an end-to-end proxy: switching to a note with no blocks yet can synchronously import, parse, and save blocks during render before the view settles.`;
    case 'active-leaf-debounce':
      return `This captures the active-leaf-change debounce window; if it stays responsive, it is queued background overhead rather than the direct UI blocker.`;
    case 'lookup-open':
      return `Lookup-open latency is reported as a trigger-plus-settle proxy for showing the search surface itself; it is separate from the first semantic query.`;
    case 'lookup-first-query':
      return `Lookup-first-query latency captures trigger-plus-settle search/render cost after the view opens; it should be separated from note-switch import costs.`;
    default:
      return state.description ?? `Measured ${state.label} latency.`;
  }
}

export function summarizeLatencyState(state, sampleMetrics) {
  const completedValues = sampleMetrics
    .map((sample) => sample.primaryDurationMs)
    .filter((value) => Number.isFinite(value));
  const triggerValues = sampleMetrics
    .map((sample) => sample.triggerDurationMs)
    .filter((value) => Number.isFinite(value));

  const medianMs = completedValues.length ? round(percentile(completedValues, 0.5)) : null;
  const p95Ms = completedValues.length >= 3 ? round(percentile(completedValues, 0.95)) : null;
  const worstCaseMs = completedValues.length ? round(Math.max(...completedValues)) : null;
  const triggerMedianMs = triggerValues.length ? round(percentile(triggerValues, 0.5)) : null;
  const triggerWorstCaseMs = triggerValues.length ? round(Math.max(...triggerValues)) : null;
  const timeoutCount = sampleMetrics.reduce((sum, sample) => sum + (sample.timeoutCount ?? 0), 0);
  const emptyPollCount = sampleMetrics.reduce((sum, sample) => sum + (sample.emptyPollCount ?? 0), 0);
  const freezeDetected = sampleMetrics.some((sample) => sample.freezeDetected);
  const impact = classifyLatencyImpact(state.id, sampleMetrics);

  return {
    id: state.id,
    label: state.label,
    codePath: state.codePath,
    sampleCount: sampleMetrics.length,
    medianMs,
    p95Ms,
    worstCaseMs,
    triggerMedianMs,
    triggerWorstCaseMs,
    timeoutCount,
    emptyPollCount,
    freezeDetected,
    impact,
    explanation: buildExplanation(state, { medianMs, p95Ms, worstCaseMs, impact }),
    samples: sampleMetrics,
  };
}
