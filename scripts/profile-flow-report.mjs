const STATUS_SEVERITY = {
  freeze_detected: 4,
  failed: 3,
  partial: 2,
  passed: 1,
  unknown: 0,
};

function extractNumber(pattern, text) {
  const match = text.match(pattern);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function classifyScriptRun(stdout, stderr, exitCode) {
  const combined = `${stdout ?? ''}\n${stderr ?? ''}`;
  if (/FREEZE_DETECTED|UI FREEZE detected|frozen or not loaded|possible freeze|freeze detected/i.test(combined)) {
    return 'freeze_detected';
  }
  if (/RESULT:\s*PASS/i.test(combined)) return 'passed';
  if (/RESULT:\s*PARTIAL/i.test(combined)) return 'partial';
  if (/RESULT:\s*FAIL/i.test(combined) || exitCode !== 0) return 'failed';
  return 'unknown';
}

export function summarizeScriptRun(flow, run) {
  const stdout = run.stdout ?? '';
  const stderr = run.stderr ?? '';
  const status = classifyScriptRun(stdout, stderr, run.code ?? 0);
  const elapsedSeconds = extractNumber(/(?:Completed in|Time:|embed_ready after)\s+(\d+)s/i, stdout);
  const checks = extractNumber(/Checks:\s*(\d+)\//i, stdout);
  const queriesWithResults = extractNumber(/Queries with results:\s*(\d+)/i, stdout);
  const connectionsCount = extractNumber(/Connections:\s*count=(\d+)/i, stdout);
  const adapterMatch = stdout.match(/Adapter:\s*(.+)$/im) ?? stdout.match(/adapter:\s*(.+)$/im);
  return {
    flow,
    status,
    severity: STATUS_SEVERITY[status],
    commandDurationMs: run.durationMs,
    elapsedSeconds,
    checks,
    queriesWithResults,
    connectionsCount,
    adapter: adapterMatch?.[1]?.trim() ?? null,
    exitCode: run.code,
    timedOut: !!run.timedOut,
  };
}

function extractLastJsonBlock(text) {
  for (let start = text.lastIndexOf('{'); start >= 0; start = text.lastIndexOf('{', start - 1)) {
    const candidate = text.slice(start).trim();
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

export function summarizeScalingRun(run) {
  const stdout = run.stdout ?? '';
  const stderr = run.stderr ?? '';
  const status = classifyScriptRun(stdout, stderr, run.code ?? 0);
  const parsed = (() => {
    const jsonBlock = extractLastJsonBlock(stdout);
    if (!jsonBlock) return null;
    try {
      return JSON.parse(jsonBlock);
    } catch {
      return null;
    }
  })();

  const batches = Array.isArray(parsed?.batches) ? parsed.batches : [];
  const failedBatches = batches.filter((batch) => batch.status === 'failed').length;
  const slowestConnectionsViewMs = batches.reduce((max, batch) => {
    const mean = batch?.timing?.connectionsView?.meanMs ?? 0;
    return Math.max(max, mean);
  }, 0);

  return {
    flow: 'indexing',
    status,
    severity: STATUS_SEVERITY[status],
    commandDurationMs: run.durationMs,
    artifactPath: parsed?.artifactPath ?? null,
    batchCount: batches.length,
    failedBatches,
    slowestConnectionsViewMs,
    exitCode: run.code,
    timedOut: !!run.timedOut,
  };
}

export function rankFlowSummaries(summaries) {
  return [...summaries].sort((left, right) => {
    if (right.severity !== left.severity) return right.severity - left.severity;
    const rightCost = right.elapsedSeconds ?? Math.round((right.commandDurationMs ?? 0) / 1000);
    const leftCost = left.elapsedSeconds ?? Math.round((left.commandDurationMs ?? 0) / 1000);
    if (rightCost !== leftCost) return rightCost - leftCost;
    return (right.commandDurationMs ?? 0) - (left.commandDurationMs ?? 0);
  });
}
