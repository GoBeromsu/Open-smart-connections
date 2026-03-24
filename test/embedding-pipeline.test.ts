/**
 * @file embedding-pipeline.test.ts
 * @description Dimension-aware pipeline tuning (Step 1.4)
 *
 * Tests the pure calculation functions for effective save interval and
 * concurrency cap based on embedding dimensions.
 *
 * Once the developer exports these from src/ui/embed-orchestrator.ts:
 *   export function getEffectiveSaveInterval(dims: number, configuredInterval: number): number
 *   export function getEffectiveConcurrency(dims: number, configuredConcurrency: number): number
 *
 * Replace the inline spec helpers below with:
 *   import { getEffectiveSaveInterval, getEffectiveConcurrency } from '../src/ui/embed-orchestrator';
 */

import { describe, expect, it } from 'vitest';

// ── Inline spec helpers ───────────────────────────────────────────────────────
// Mirror the target implementation from the plan (Step 1.4):
//   dims > 1024 → save interval 2 (most frequent saves to flush heap pressure)
//   dims > 512  → save interval 3
//   else        → use configured value (default 5)
//
//   dims > 1024 → concurrency capped at min(configured, 3), min 1
//   else        → use configured value

function getEffectiveSaveInterval(dims: number, configuredInterval: number): number {
  return dims > 1024 ? 2 : dims > 512 ? 3 : configuredInterval;
}

function getEffectiveConcurrency(dims: number, configuredConcurrency: number): number {
  return dims > 1024
    ? Math.max(1, Math.min(configuredConcurrency, 3))
    : configuredConcurrency;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getEffectiveSaveInterval', () => {
  it('returns configured value unchanged for small dimensions (<=512d)', () => {
    expect(getEffectiveSaveInterval(256, 5)).toBe(5);
    expect(getEffectiveSaveInterval(384, 5)).toBe(5); // BGE-micro default — must not change
    expect(getEffectiveSaveInterval(512, 5)).toBe(5);
  });

  it('returns 3 for medium dimensions (512 < dims <= 1024)', () => {
    expect(getEffectiveSaveInterval(513, 5)).toBe(3);
    expect(getEffectiveSaveInterval(768, 5)).toBe(3); // Gemini / Snowflake-medium
    expect(getEffectiveSaveInterval(1024, 5)).toBe(3);
  });

  it('returns 2 for high dimensions (dims > 1024)', () => {
    expect(getEffectiveSaveInterval(1025, 5)).toBe(2);
    expect(getEffectiveSaveInterval(1536, 5)).toBe(2); // OpenAI ada / text-3-small
    expect(getEffectiveSaveInterval(3072, 5)).toBe(2); // OpenAI text-3-large
    expect(getEffectiveSaveInterval(4096, 5)).toBe(2); // Upstage Solar — OOM trigger
  });

  it('respects non-default configured values for small dims', () => {
    expect(getEffectiveSaveInterval(384, 1)).toBe(1);
    expect(getEffectiveSaveInterval(384, 10)).toBe(10);
  });

  it('overrides configured value for high dims regardless of user setting', () => {
    expect(getEffectiveSaveInterval(4096, 1)).toBe(2); // even if user set 1
    expect(getEffectiveSaveInterval(4096, 10)).toBe(2); // even if user set 10
  });
});

describe('getEffectiveConcurrency', () => {
  it('returns configured value unchanged for small dimensions (<=1024d)', () => {
    expect(getEffectiveConcurrency(256, 5)).toBe(5);
    expect(getEffectiveConcurrency(384, 5)).toBe(5); // BGE-micro default — must not change
    expect(getEffectiveConcurrency(768, 5)).toBe(5);
    expect(getEffectiveConcurrency(1024, 5)).toBe(5);
  });

  it('caps concurrency at 3 for high dimensions (dims > 1024)', () => {
    expect(getEffectiveConcurrency(1025, 5)).toBe(3);
    expect(getEffectiveConcurrency(3072, 5)).toBe(3); // OpenAI text-3-large
    expect(getEffectiveConcurrency(4096, 5)).toBe(3); // Upstage Solar — cap at 3
  });

  it('respects lower configured values for high dims', () => {
    expect(getEffectiveConcurrency(4096, 1)).toBe(1);
    expect(getEffectiveConcurrency(4096, 2)).toBe(2);
    expect(getEffectiveConcurrency(4096, 3)).toBe(3);
  });

  it('clamps to minimum 1 for high dims when configured value is zero or negative', () => {
    expect(getEffectiveConcurrency(4096, 0)).toBe(1);
    expect(getEffectiveConcurrency(4096, -1)).toBe(1);
  });

  it('uses configured value as-is for 1024d boundary (not capped)', () => {
    expect(getEffectiveConcurrency(1024, 10)).toBe(10); // 1024 is NOT > 1024
  });
});
