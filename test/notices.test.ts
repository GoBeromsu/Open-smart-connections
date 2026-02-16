/**
 * @file notices.test.ts
 * @description Tests for SmartConnectionsNotices mute and reuse behavior
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartConnectionsNotices } from '../src/app/notices';

function createPluginStub() {
  return {
    settings: {
      smart_notices: {
        muted: {},
      },
    },
    saveSettings: vi.fn(async () => {}),
  } as any;
}

function getNoticeText(notice: any): string {
  if (!notice) return '';
  if (typeof notice.message === 'string') return notice.message;
  return notice.message?.textContent ?? notice.messageEl?.textContent ?? '';
}

describe('SmartConnectionsNotices', () => {
  let plugin: any;
  let notices: SmartConnectionsNotices;

  beforeEach(() => {
    plugin = createPluginStub();
    notices = new SmartConnectionsNotices(plugin);
    document.body.classList.remove('theme-dark');
    document.body.classList.remove('theme-light');
  });

  it('shows notice before mute and blocks it after mute', async () => {
    const shown = notices.show('embedding_failed');
    expect(shown).not.toBeNull();
    expect(getNoticeText(shown)).toContain('Embedding failed');

    await notices.mute('embedding_failed');

    const blocked = notices.show('embedding_failed');
    expect(blocked).toBeNull();
  });

  it('allows notice again after unmute', async () => {
    await notices.mute('embedding_failed');
    expect(notices.show('embedding_failed')).toBeNull();

    await notices.unmute('embedding_failed');
    const shown = notices.show('embedding_failed');
    expect(shown).not.toBeNull();
  });

  it('unmutes all muted notice keys', async () => {
    await notices.mute('embedding_failed');
    await notices.mute('reimport_failed');
    expect(notices.listMuted()).toEqual(['embedding_failed', 'reimport_failed']);

    await notices.unmuteAll();
    expect(notices.listMuted()).toEqual([]);
  });

  it('reuses active notice and updates content', () => {
    const first = notices.show(
      'embedding_progress',
      { adapter: 'openai', modelKey: 'text-embedding-3-small', current: 1, total: 10, percent: 10 },
      { timeout: 0 },
    );
    const second = notices.show(
      'embedding_progress',
      { adapter: 'openai', modelKey: 'text-embedding-3-small', current: 2, total: 10, percent: 20 },
      { timeout: 0 },
    );

    expect(first).toBe(second);
    expect(getNoticeText(second)).toContain('2/10');
  });

  it('syncs notice host theme with current Obsidian theme', async () => {
    document.body.classList.add('theme-light');
    const notice = notices.show('embedding_failed') as any;
    expect(notice.containerEl.classList.contains('osc-notice-host')).toBe(true);
    expect(notice.containerEl.getAttribute('data-osc-theme')).toBe('light');

    document.body.classList.remove('theme-light');
    document.body.classList.add('theme-dark');

    notices.show('embedding_failed');
    expect(notice.containerEl.getAttribute('data-osc-theme')).toBe('dark');
  });
});
