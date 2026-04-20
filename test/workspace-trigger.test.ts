import { describe, expect, it, vi } from 'vitest';
import { Workspace } from 'obsidian';

describe('Workspace trigger mock', () => {
  it('dispatches payloads to registered handlers and supports offref cleanup', () => {
    const workspace = new Workspace();
    const handler = vi.fn();

    const ref = workspace.on('open-connections:embed-state-changed', handler);
    workspace.trigger('open-connections:embed-state-changed', { prev: 'running', phase: 'idle' });

    expect(handler).toHaveBeenCalledWith({ prev: 'running', phase: 'idle' });

    workspace.offref(ref);
    workspace.trigger('open-connections:embed-state-changed', { prev: 'running', phase: 'idle' });

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
