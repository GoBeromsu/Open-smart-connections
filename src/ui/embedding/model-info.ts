import type SmartConnectionsPlugin from '../../main';
import type { EmbeddingRunContext } from '../../types/embed-runtime';

export function getCurrentModelInfo(
  plugin: SmartConnectionsPlugin,
): { adapter: string; modelKey: string; dims: number | null } {
  const adapter = plugin.embed_adapter?.adapter
    ?? plugin.settings?.smart_sources?.embed_model?.adapter
    ?? 'unknown';
  const modelKey = plugin.embed_adapter?.model_key
    ?? (plugin.getEmbedAdapterSettings(plugin.settings?.smart_sources?.embed_model as Record<string, unknown>)?.model_key as string | undefined)
    ?? 'unknown';
  const dims = plugin.embed_adapter?.dims ?? null;
  return { adapter, modelKey, dims };
}

export function getActiveEmbeddingContext(plugin: SmartConnectionsPlugin): EmbeddingRunContext | null {
  if (!plugin.current_embed_context) return null;
  return { ...plugin.current_embed_context };
}

export function publishEmbedContext(plugin: SmartConnectionsPlugin, context: EmbeddingRunContext): void {
  plugin.current_embed_context = { ...context };
}
