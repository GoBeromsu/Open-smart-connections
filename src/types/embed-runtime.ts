/**
 * @file embed-runtime.ts
 * @description Shared runtime and event payload types for embedding state.
 */

export type EmbedRunOutcome = 'completed' | 'halted' | 'failed';

export type EmbedRunPhase =
  | 'running'
  | 'completed'
  | 'halted'
  | 'failed'
  | 'followup-required';

export type EmbedStatePhase = 'idle' | 'running' | 'error';

export interface EmbeddingRunContext {
  runId: number;
  phase: EmbedRunPhase;
  outcome?: EmbedRunOutcome;
  reason: string;
  adapter: string;
  modelKey: string;
  dims: number | null;
  currentEntityKey: string | null;
  currentSourcePath: string | null;
  startedAt: number;
  current: number;
  total: number;
  blockTotal: number;
  saveCount: number;
  sourceDataDir: string;
  blockDataDir: string;
  followupQueued?: boolean;
  error?: string | null;
}

export interface EmbedProgressEventPayload {
  runId: number;
  phase: EmbeddingRunContext['phase'];
  outcome?: EmbedRunOutcome;
  reason: string;
  adapter: string;
  modelKey: string;
  dims: number | null;
  currentEntityKey: string | null;
  currentSourcePath: string | null;
  current: number;
  total: number;
  percent: number;
  blockTotal: number;
  saveCount: number;
  sourceDataDir: string;
  blockDataDir: string;
  startedAt: number;
  elapsedMs: number;
  followupQueued?: boolean;
  done?: boolean;
  error?: string;
}

export interface EmbedStateSnapshot {
  phase: EmbedStatePhase;
  modelFingerprint: string | null;
  lastError: string | null;
}

export interface EmbedStateChangePayload {
  phase: EmbedStatePhase;
  prev: EmbedStatePhase;
}
