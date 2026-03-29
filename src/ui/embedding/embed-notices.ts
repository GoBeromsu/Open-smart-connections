import type SmartConnectionsPlugin from '../../main';
import type { EmbeddingRunContext } from '../../types/embed-runtime';
import { ItemView } from 'obsidian';
import { CONNECTIONS_VIEW_TYPE } from '../ConnectionsView';

export function clearEmbedNotice(plugin: SmartConnectionsPlugin): void {
  plugin.notices.remove('embedding_progress');
  plugin.embed_notice_last_update = 0;
  plugin.embed_notice_last_percent = 0;
}

export function updateEmbedNotice(
  plugin: SmartConnectionsPlugin,
  context: EmbeddingRunContext,
  force = false,
): void {
  const connectionsLeaves = plugin.app.workspace.getLeavesOfType(CONNECTIONS_VIEW_TYPE);
  const isViewVisible = connectionsLeaves.some((leaf) => {
    const containerEl = (leaf.view as ItemView)?.containerEl;
    return typeof containerEl?.checkVisibility === 'function' ? containerEl.checkVisibility() : false;
  });

  if (isViewVisible) {
    clearEmbedNotice(plugin);
    return;
  }

  const percent = context.total > 0 ? Math.round((context.current / context.total) * 100) : 0;
  const now = Date.now();
  const shouldUpdate =
    force ||
    plugin.embed_notice_last_update === 0 ||
    now - plugin.embed_notice_last_update >= 3000 ||
    Math.abs(percent - plugin.embed_notice_last_percent) >= 5;

  if (!shouldUpdate) return;

  plugin.notices.show(
    'embedding_progress',
    {
      adapter: context.adapter,
      modelKey: context.modelKey,
      current: context.current,
      total: context.total,
      percent,
    },
    { timeout: 0 },
  );
  plugin.embed_notice_last_update = now;
  plugin.embed_notice_last_percent = percent;
}

function classifyEmbeddingFailureNotice(error: string): 'embedding_provider_limited' | null {
  const normalized = error.toLowerCase();
  if (
    normalized.includes('too_many_requests') ||
    normalized.includes('rate limit') ||
    normalized.includes('request limit') ||
    normalized.includes('status: 429') ||
    normalized.includes('status=429') ||
    normalized.includes('"status":429')
  ) {
    return 'embedding_provider_limited';
  }
  return null;
}

export function showEmbeddingFailureNotice(
  plugin: SmartConnectionsPlugin,
  context: EmbeddingRunContext,
  error: string | null | undefined,
): void {
  const noticeId = error ? classifyEmbeddingFailureNotice(error) : null;
  if (noticeId) {
    plugin.notices.show(noticeId, {
      adapter: context.adapter,
      modelKey: context.modelKey,
    });
    return;
  }
  plugin.notices.show('embedding_failed');
}
