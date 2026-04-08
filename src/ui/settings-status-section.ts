import { Setting } from 'obsidian';

import { renderEmbedProgress } from './embed-progress';
import { getRuntimeState } from './settings-status-runtime-state';
import { setElementText } from './settings-status-pill-render';
import { updateStatusPills } from './settings-status-pills';
import { renderStatsGrid, updateStatsGrid } from './settings-status-stats-grid';
import type { EmbeddingStatusElements, SmartConnectionsPlugin } from './settings-types';

export function renderEmbeddingStatus(
  containerEl: HTMLElement,
  plugin: SmartConnectionsPlugin,
): EmbeddingStatusElements {
  const activeCtx = plugin.getActiveEmbeddingContext?.() ?? null;
  const status = plugin.status_state ?? 'idle';

  const statusRowEl = containerEl.createDiv({ cls: 'osc-model-status' });
  updateStatusPills(plugin, statusRowEl);

  const statsGridEl = renderStatsGrid(containerEl, plugin);

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
  const runtime = getRuntimeState(plugin);

  if (elements.statusRowEl) updateStatusPills(plugin, elements.statusRowEl);

  if (elements.statsGridEl) {
    updateStatsGrid(elements.statsGridEl, plugin);
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

  if (runtime?.serving.kind === 'degraded') {
    if (typeof (elements.currentRunSettingEl as HTMLElement & { removeClass?: (cls: string) => void })?.removeClass === 'function') {
      (elements.currentRunSettingEl as HTMLElement & { removeClass: (cls: string) => void }).removeClass('osc-hidden');
    } else {
      elements.currentRunSettingEl?.classList.remove('osc-hidden');
    }
    setElementText(
      elements.currentRunEl,
      runtime.serving.error
        ? `Background embedding degraded. Indexed notes remain queryable. Last error: ${runtime.serving.error}`
        : 'Background embedding degraded. Indexed notes remain queryable.',
    );
    return;
  }

  if (status === 'error') {
    if (typeof (elements.currentRunSettingEl as HTMLElement & { removeClass?: (cls: string) => void })?.removeClass === 'function') {
      (elements.currentRunSettingEl as HTMLElement & { removeClass: (cls: string) => void }).removeClass('osc-hidden');
    } else {
      elements.currentRunSettingEl?.classList.remove('osc-hidden');
    }
    setElementText(elements.currentRunEl, 'Embedding model is unavailable. Check settings and notices for details.');
    return;
  }

  if (typeof (elements.currentRunSettingEl as HTMLElement & { addClass?: (cls: string) => void })?.addClass === 'function') {
    (elements.currentRunSettingEl as HTMLElement & { addClass: (cls: string) => void }).addClass('osc-hidden');
  } else {
    elements.currentRunSettingEl?.classList.add('osc-hidden');
  }
}
