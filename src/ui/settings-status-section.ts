import { Setting } from 'obsidian';

import { renderEmbedProgress } from './embed-progress';
import type { EmbeddingStatusElements, SmartConnectionsPlugin } from './settings-types';

function getRunStateLabel(status: NonNullable<SmartConnectionsPlugin['status_state']>): string {
  switch (status) {
    case 'embedding':
      return 'Running';
    case 'error':
      return 'Error';
    default:
      return 'Idle';
  }
}

function getRunStateTone(
  status: NonNullable<SmartConnectionsPlugin['status_state']>,
): 'ready' | 'loading' | 'error' {
  switch (status) {
    case 'error':
      return 'error';
    case 'embedding':
      return 'ready';
    default:
      return 'loading';
  }
}

function renderStatusPill(
  containerEl: HTMLElement,
  label: string,
  value: string,
  active: boolean,
  tone: 'ready' | 'loading' | 'error' = active ? 'ready' : 'loading',
): void {
  const pill = containerEl.createDiv({ cls: 'osc-status-pill' });
  const dot = pill.createSpan({ cls: 'osc-status-dot' });
  const dotClassMap: Record<string, string> = {
    error: 'osc-status-dot--error',
    ready: 'osc-status-dot--ready',
    loading: 'osc-status-dot--loading',
  };
  dot.addClass(dotClassMap[tone] ?? 'osc-status-dot--loading');
  pill.createSpan({ cls: 'osc-status-text', text: `${label}: ${value}` });
}

function renderStatCard(
  containerEl: HTMLElement,
  label: string,
  value: string,
  tone?: 'green' | 'amber',
): void {
  const card = containerEl.createDiv({ cls: 'osc-stat-card' });
  if (tone === 'green') card.addClass('osc-stat--green');
  else if (tone === 'amber') card.addClass('osc-stat--amber');
  card.createDiv({ cls: 'osc-stat-value', text: value });
  card.createDiv({ cls: 'osc-stat-label', text: label });
}

function setElementText(element: HTMLElement, text: string): void {
  const target = element as HTMLElement & { setText?: (value: string) => void };
  if (typeof target.setText === 'function') {
    target.setText(text);
    return;
  }
  element.textContent = text;
}

function updateStatusPills(plugin: SmartConnectionsPlugin, statusRow: HTMLElement): void {
  const status = plugin.status_state ?? 'idle';
  statusRow.empty();
  renderStatusPill(statusRow, 'Core', plugin.ready ? 'Ready' : 'Loading', !!plugin.ready);
  renderStatusPill(statusRow, 'Embedding', plugin.embed_ready ? 'Ready' : 'Loading', !!plugin.embed_ready);
  renderStatusPill(statusRow, 'Run', getRunStateLabel(status), status === 'embedding', getRunStateTone(status));
}

export function renderEmbeddingStatus(
  containerEl: HTMLElement,
  plugin: SmartConnectionsPlugin,
): EmbeddingStatusElements {
  const collection = plugin.source_collection;
  const total = collection?.size ?? 0;
  const embedded = plugin.block_collection?.embeddedSourceCount ?? 0;
  const pending = Math.max(0, total - embedded);
  const pct = total > 0 ? Math.round((embedded / total) * 100) : 0;
  const activeCtx = plugin.getActiveEmbeddingContext?.() ?? null;
  const status = plugin.status_state ?? 'idle';

  const statusRowEl = containerEl.createDiv({ cls: 'osc-model-status' });
  updateStatusPills(plugin, statusRowEl);

  const statsGridEl = containerEl.createDiv({ cls: 'osc-stats-grid' });
  renderStatCard(statsGridEl, 'Total', total.toLocaleString());
  renderStatCard(statsGridEl, 'Embedded', embedded.toLocaleString(), 'green');
  renderStatCard(statsGridEl, 'Pending', pending.toLocaleString(), pending > 0 ? 'amber' : undefined);
  renderStatCard(statsGridEl, 'Progress', `${pct}%`, pct >= 100 ? 'green' : undefined);

  const embedProgress = renderEmbedProgress(containerEl, plugin);
  const runSetting = new Setting(containerEl)
    .setName('Current run')
    .setDesc('-');

  const elements: EmbeddingStatusElements = {
    eventRefs: [],
    statusRowEl,
    statsGridEl,
    currentRunEl: runSetting.descEl,
    currentRunSettingEl: runSetting.settingEl,
    embedProgress,
  };

  updateEmbeddingStatusOnly(plugin, elements, activeCtx, status);
  return elements;
}

export function updateEmbeddingStatusOnly(
  plugin: SmartConnectionsPlugin,
  elements: EmbeddingStatusElements,
  activeCtx = plugin.getActiveEmbeddingContext?.() ?? null,
  status = plugin.status_state ?? 'idle',
): void {
  if (elements.statusRowEl) updateStatusPills(plugin, elements.statusRowEl);

  if (elements.statsGridEl) {
    const total = plugin.source_collection?.size ?? 0;
    const embedded = plugin.block_collection?.embeddedSourceCount ?? 0;
    const pending = Math.max(0, total - embedded);
    const pct = total > 0 ? Math.round((embedded / total) * 100) : 0;
    elements.statsGridEl.empty();
    renderStatCard(elements.statsGridEl, 'Total', total.toLocaleString());
    renderStatCard(elements.statsGridEl, 'Embedded', embedded.toLocaleString(), 'green');
    renderStatCard(elements.statsGridEl, 'Pending', pending.toLocaleString(), pending > 0 ? 'amber' : undefined);
    renderStatCard(elements.statsGridEl, 'Progress', `${pct}%`, pct >= 100 ? 'green' : undefined);
  }

  elements.embedProgress?.update();
  if (!elements.currentRunEl) return;

  if (status === 'embedding' && activeCtx) {
    if (typeof (elements.currentRunSettingEl as HTMLElement & { removeClass?: (cls: string) => void })?.removeClass === 'function') {
      (elements.currentRunSettingEl as HTMLElement & { removeClass: (cls: string) => void }).removeClass('osc-hidden');
    } else {
      elements.currentRunSettingEl?.classList.remove('osc-hidden');
    }
    const runCurrent = activeCtx.current ?? 0;
    const runTotal = activeCtx.total ?? 0;
    const runPercent = runTotal > 0 ? Math.round((runCurrent / runTotal) * 100) : 0;
    const currentItem = activeCtx.currentSourcePath ?? activeCtx.currentEntityKey ?? '-';
    setElementText(
      elements.currentRunEl,
      `Run #${activeCtx.runId ?? '-'} • ${runCurrent.toLocaleString()}/${runTotal.toLocaleString()} (${runPercent}%) • ${currentItem}`,
    );
    return;
  }

  if (status === 'error') {
    if (typeof (elements.currentRunSettingEl as HTMLElement & { removeClass?: (cls: string) => void })?.removeClass === 'function') {
      (elements.currentRunSettingEl as HTMLElement & { removeClass: (cls: string) => void }).removeClass('osc-hidden');
    } else {
      elements.currentRunSettingEl?.classList.remove('osc-hidden');
    }
    setElementText(elements.currentRunEl, 'Embedding run encountered an error. Check notices for details.');
    return;
  }

  if (typeof (elements.currentRunSettingEl as HTMLElement & { addClass?: (cls: string) => void })?.addClass === 'function') {
    (elements.currentRunSettingEl as HTMLElement & { addClass: (cls: string) => void }).addClass('osc-hidden');
  } else {
    elements.currentRunSettingEl?.classList.add('osc-hidden');
  }
}
