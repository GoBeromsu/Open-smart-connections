import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/commands', () => ({ registerCommands: vi.fn() }));
vi.mock('../src/ui/plugin-codeblock', () => ({ registerSmartConnectionsCodeBlock: vi.fn() }));
vi.mock('../src/ui/settings', () => ({
  SmartConnectionsSettingsTab: class SmartConnectionsSettingsTab {
    constructor(public app: unknown, public plugin: unknown) {}
  },
}));

import { App } from 'obsidian';
import { ConnectionsView, CONNECTIONS_VIEW_TYPE } from '../src/ui/ConnectionsView';
import { registerPluginUi } from '../src/ui/plugin-registration';

describe('registerPluginUi — ConnectionsView wiring', () => {
  const registerView = vi.fn();
  const addSettingTab = vi.fn();
  const addRibbonIcon = vi.fn();

  const sharedReader = { marker: 'shared-reader' };
  const plugin = {
    app: new App(),
    settings: {},
    ready: true,
    embed_ready: true,
    status_state: 'idle',
    pendingReImportPaths: new Set<string>(),
    connectionsReader: sharedReader,
    registerView,
    addSettingTab,
    addRibbonIcon,
  } as any;

  beforeEach(() => {
    registerView.mockReset();
    addSettingTab.mockReset();
    addRibbonIcon.mockReset();
  });

  it('registers a ConnectionsView factory that injects a reader', () => {
    registerPluginUi(plugin);

    const connectionEntry = registerView.mock.calls.find(([type]) => type === CONNECTIONS_VIEW_TYPE);
    expect(connectionEntry).toBeTruthy();

    const factory = connectionEntry?.[1] as (leaf: unknown) => ConnectionsView;
    const view = factory({} as any);

    expect(view).toBeInstanceOf(ConnectionsView);
    expect((view as ConnectionsView & { reader?: unknown }).reader).toBe(sharedReader);
  });
});
