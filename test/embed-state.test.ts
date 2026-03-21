import { describe, it, expect } from 'vitest';

// Since setEmbedPhase is on the plugin class, we test it with a minimal mock
// that mimics the relevant parts of SmartConnectionsPlugin
function createMockPlugin() {
  const events: Array<{ phase: string; prev: string }> = [];
  const plugin = {
    _embed_state: { phase: 'idle' as 'idle' | 'running' | 'error', modelFingerprint: null as string | null, lastError: null as string | null },
    app: { workspace: { trigger: (_: any, payload: any) => { events.push(payload); } } },
    status_msg: null,
    status_container: null,
    refreshStatus() { /* no-op in test */ },
    get embed_ready(): boolean {
      return this._embed_state.phase !== 'error' && this._embed_state.modelFingerprint !== null;
    },
    get status_state(): 'idle' | 'embedding' | 'error' {
      return this._embed_state.phase === 'running' ? 'embedding' : this._embed_state.phase;
    },
    setEmbedPhase(phase: 'idle' | 'running' | 'error', opts: { error?: string; fingerprint?: string } = {}): void {
      const prev = this._embed_state.phase;
      this._embed_state = {
        phase,
        modelFingerprint: opts.fingerprint ?? this._embed_state.modelFingerprint,
        lastError: phase === 'error' ? (opts.error ?? this._embed_state.lastError) : null,
      };
      if (prev !== phase) {
        this.app.workspace.trigger('smart-connections:embed-state-changed' as any, { phase, prev });
        this.refreshStatus();
      }
    },
    resetError(): void {
      if (this._embed_state.lastError) {
        this._embed_state = { ...this._embed_state, lastError: null };
      }
    },
    events, // for assertions
  };
  return plugin;
}

describe('setEmbedPhase', () => {
  it('starts in idle phase', () => {
    const p = createMockPlugin();
    expect(p._embed_state.phase).toBe('idle');
  });

  it('fires workspace event on phase change', () => {
    const p = createMockPlugin();
    p.setEmbedPhase('running');
    expect(p.events).toHaveLength(1);
    expect(p.events[0]).toEqual({ phase: 'running', prev: 'idle' });
  });

  it('does NOT fire event when phase stays the same', () => {
    const p = createMockPlugin();
    p.setEmbedPhase('idle');
    expect(p.events).toHaveLength(0);
  });

  it('preserves lastError on error phase', () => {
    const p = createMockPlugin();
    p.setEmbedPhase('error', { error: 'API key expired' });
    expect(p._embed_state.lastError).toBe('API key expired');
    expect(p._embed_state.phase).toBe('error');
  });

  it('clears lastError when leaving error phase', () => {
    const p = createMockPlugin();
    p.setEmbedPhase('error', { error: 'test error' });
    p.setEmbedPhase('idle');
    expect(p._embed_state.lastError).toBeNull();
  });

  it('updates fingerprint', () => {
    const p = createMockPlugin();
    p.setEmbedPhase('idle', { fingerprint: 'transformers|minilm|' });
    expect(p._embed_state.modelFingerprint).toBe('transformers|minilm|');
  });

  it('preserves fingerprint when not specified', () => {
    const p = createMockPlugin();
    p.setEmbedPhase('idle', { fingerprint: 'fp1' });
    p.setEmbedPhase('running');
    expect(p._embed_state.modelFingerprint).toBe('fp1');
  });
});

describe('embed_ready', () => {
  it('returns false when no fingerprint', () => {
    const p = createMockPlugin();
    expect(p.embed_ready).toBe(false);
  });

  it('returns true when fingerprint set and not error', () => {
    const p = createMockPlugin();
    p.setEmbedPhase('idle', { fingerprint: 'fp1' });
    expect(p.embed_ready).toBe(true);
  });

  it('returns false when in error phase', () => {
    const p = createMockPlugin();
    p.setEmbedPhase('idle', { fingerprint: 'fp1' });
    p.setEmbedPhase('error', { error: 'fail' });
    expect(p.embed_ready).toBe(false);
  });
});

describe('status_state', () => {
  it('maps idle to idle', () => {
    const p = createMockPlugin();
    expect(p.status_state).toBe('idle');
  });

  it('maps running to embedding', () => {
    const p = createMockPlugin();
    p.setEmbedPhase('running');
    expect(p.status_state).toBe('embedding');
  });

  it('maps error to error', () => {
    const p = createMockPlugin();
    p.setEmbedPhase('error', { error: 'x' });
    expect(p.status_state).toBe('error');
  });
});

describe('resetError', () => {
  it('clears lastError', () => {
    const p = createMockPlugin();
    p.setEmbedPhase('error', { error: 'test' });
    p.resetError();
    expect(p._embed_state.lastError).toBeNull();
  });

  it('is no-op when no error', () => {
    const p = createMockPlugin();
    p.resetError();
    expect(p._embed_state.lastError).toBeNull();
  });
});
