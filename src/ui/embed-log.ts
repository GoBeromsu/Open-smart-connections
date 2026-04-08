import type SmartConnectionsPlugin from '../main';
import type { EmbedProgressEventPayload } from '../types/embed-runtime';

const NOISY_EVENTS = new Set([
  'run-progress',
  'run-save',
  'queue-unembedded-entities',
  'reimport-queue-ready',
  'run-skip-empty',
  'run-skip-active',
]);

export function logEmbed(
  plugin: SmartConnectionsPlugin,
  event: string,
  context: Partial<EmbedProgressEventPayload> = {},
): void {
  if (NOISY_EVENTS.has(event)) return;

  const runId = context.runId ?? plugin.current_embed_context?.runId ?? '-';
  const current = context.current;
  const total = context.total;
  const progress = typeof current === 'number' && typeof total === 'number'
    ? ` ${current}/${total}`
    : '';
  const model = context.adapter && context.modelKey
    ? ` ${context.adapter}/${context.modelKey}`
    : '';
  const note = context.currentSourcePath ? ` ${context.currentSourcePath}` : '';
  const reason = context.reason ? ` reason="${context.reason}"` : '';
  const error = context.error ? ` error="${context.error}"` : '';

  plugin.logger.info(`[Embed] ${event} run=${runId}${progress}${model}${note}${reason}${error}`);
}
