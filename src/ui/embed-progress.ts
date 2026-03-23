/**
 * @file embed-progress.ts
 * @description Shared dual progress bar component (Notes + Blocks) for ConnectionsView and Settings.
 * Uses Obsidian's native ProgressBarComponent. No ETA.
 */

import { ProgressBarComponent } from 'obsidian';

/**
 * Renders a dual progress bar (Notes + Blocks) into the given container element.
 * Returns handles to update values and destroy the DOM.
 *
 * @param prepend - When true, inserts the wrapper at the top of container (default: appended)
 */
export function renderEmbedProgress(
  container: HTMLElement,
  plugin: any,
  { prepend = false }: { prepend?: boolean } = {},
): { update(): void; destroy(): void } {
  const wrapper = container.createDiv({ cls: 'osc-embed-dual-progress' });
  if (prepend) {
    container.prepend(wrapper); // moves from last to first position
  }

  // Notes row
  const notesRow = wrapper.createDiv({ cls: 'osc-embed-dual-progress-row' });
  notesRow.createSpan({ cls: 'osc-embed-dual-progress-label', text: 'Notes' });
  const notesBar = new ProgressBarComponent(notesRow);
  const notesCount = notesRow.createSpan({ cls: 'osc-embed-dual-progress-count' });

  // Blocks row
  const blocksRow = wrapper.createDiv({ cls: 'osc-embed-dual-progress-row' });
  blocksRow.createSpan({ cls: 'osc-embed-dual-progress-label', text: 'Blocks' });
  const blocksBar = new ProgressBarComponent(blocksRow);
  const blocksCount = blocksRow.createSpan({ cls: 'osc-embed-dual-progress-count' });

  function update(): void {
    const notesTotal = plugin.app?.vault?.getMarkdownFiles()?.length ?? 0;
    const notesEmbedded = plugin.source_collection?.all?.filter((s: any) => s.vec)?.length ?? 0;
    const notesPct = notesTotal > 0 ? Math.round((notesEmbedded / notesTotal) * 100) : 0;
    notesBar.setValue(notesPct);
    notesCount.setText(`${notesEmbedded.toLocaleString()}/${notesTotal.toLocaleString()}`);

    const blocksAll = plugin.block_collection?.all ?? [];
    const blocksTotal = blocksAll.length;
    const blocksEmbedded = blocksAll.filter((b: any) => b.vec).length;
    const blocksPct = blocksTotal > 0 ? Math.round((blocksEmbedded / blocksTotal) * 100) : 0;
    blocksBar.setValue(blocksPct);
    blocksCount.setText(`${blocksEmbedded.toLocaleString()}/${blocksTotal.toLocaleString()}`);
  }

  update();

  return {
    update,
    destroy: () => wrapper.remove(),
  };
}
