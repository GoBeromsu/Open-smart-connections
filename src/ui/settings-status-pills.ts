import {
  getEmbeddingPill,
  getRunStateLabel,
  getRunStateTone,
  getRuntimeState,
} from './settings-status-runtime-state';
import { renderStatusPill } from './settings-status-pill-render';
import type { SmartConnectionsPlugin } from './settings-types';

export function updateStatusPills(
  plugin: SmartConnectionsPlugin,
  statusRow: HTMLElement,
): void {
  const status = plugin.status_state ?? 'idle';
  const runtime = getRuntimeState(plugin);
  const embeddingPill = getEmbeddingPill(plugin, runtime);
  statusRow.empty();
  renderStatusPill(statusRow, 'Core', plugin.ready ? 'Ready' : 'Loading', !!plugin.ready);
  renderStatusPill(statusRow, 'Embedding', embeddingPill.value, embeddingPill.active, embeddingPill.tone);
  renderStatusPill(
    statusRow,
    'Run',
    getRunStateLabel(status, runtime),
    status === 'embedding',
    getRunStateTone(status, runtime),
  );
}
