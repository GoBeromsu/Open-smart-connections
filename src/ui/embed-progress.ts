import { ProgressBarComponent } from 'obsidian';

const COMPLETION_VISIBLE_MS = 1500;
const COMPLETION_FADE_MS = 300;

type Phase = 0 | 1 | 2 | 3;

export function renderEmbedProgress(
  container: HTMLElement,
  plugin: any,
  { prepend = false }: { prepend?: boolean } = {},
): { update(): void; destroy(): void } {
  const wrapper = container.createDiv({ cls: 'osc-embed-progress' });
  if (prepend) container.prepend(wrapper);

  const header = wrapper.createDiv({ cls: 'osc-embed-progress-header' });
  const labelEl = header.createSpan({ cls: 'osc-embed-progress-label' });
  const countEl = header.createSpan({ cls: 'osc-embed-progress-count' });

  const barRow = wrapper.createDiv({ cls: 'osc-embed-progress-bar-row' });
  const bar = new ProgressBarComponent(barRow);
  const pctEl = barRow.createSpan({ cls: 'osc-embed-progress-percent' });

  const heartbeat = wrapper.createDiv({ cls: 'osc-embed-progress-heartbeat' });

  let previousFilename = '';
  let completionTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    if (completionTimer) clearTimeout(completionTimer);
    wrapper.remove();
  }

  function detectPhase(embeddedBlocks: number, totalBlocks: number): Phase {
    // Phase 0: model not ready
    if (!plugin.embed_ready && plugin.status_state !== 'error') return 0;
    // Phase 3: complete
    if (totalBlocks > 0 && embeddedBlocks >= totalBlocks && plugin.status_state === 'idle') return 3;
    // Phase 1: discovery (embedding started but no blocks embedded yet)
    if (plugin.status_state === 'embedding' && embeddedBlocks === 0) return 1;
    // Phase 2: active embedding
    if (plugin.status_state === 'embedding' && embeddedBlocks > 0) return 2;
    // Fallback: treat as phase 2 if blocks exist, else idle (don't show)
    return totalBlocks > 0 && embeddedBlocks < totalBlocks ? 2 : 3;
  }

  function update(): void {
    if (destroyed) return;

    const blocksAll = plugin.block_collection?.all ?? [];
    const totalBlocks = blocksAll.length;
    const embeddedBlocks = totalBlocks > 0 ? blocksAll.filter((b: any) => b.vec).length : 0;

    const notesTotal = plugin.app?.vault?.getMarkdownFiles()?.length ?? 0;
    const notesEmbedded = plugin.source_collection?.all?.filter((s: any) => s.vec)?.length ?? 0;

    const phase = detectPhase(embeddedBlocks, totalBlocks);

    if (phase < 3 && completionTimer) {
      clearTimeout(completionTimer);
      completionTimer = null;
      wrapper.removeClass('osc-embed-progress--complete');
    }

    if (phase <= 1) {
      wrapper.addClass('osc-embed-progress--indeterminate');
    } else {
      wrapper.removeClass('osc-embed-progress--indeterminate');
    }

    const pending = totalBlocks - embeddedBlocks;
    const vaultPct = totalBlocks > 0 ? Math.round((embeddedBlocks / totalBlocks) * 100) : 0;

    switch (phase) {
      case 0:
        labelEl.setText('Preparing model...');
        countEl.setText('');
        pctEl.setText('');
        heartbeat.setText('');
        heartbeat.style.display = 'none';
        break;

      case 1:
        labelEl.setText('Indexing vault');
        countEl.setText(`~${notesTotal.toLocaleString()} notes`);
        pctEl.setText('');
        heartbeat.setText('');
        heartbeat.style.display = 'none';
        break;

      case 2: {
        labelEl.setText(pending > 100 ? 'Embedding vault' : 'Updating notes...');
        countEl.setText(`${notesEmbedded.toLocaleString()} notes`);
        bar.setValue(vaultPct);
        pctEl.setText(`${vaultPct}%`);

        const currentPath = plugin.current_embed_context?.currentSourcePath ?? '';
        const filename = currentPath.split('/').pop() ?? '';
        if (filename && filename !== previousFilename) {
          heartbeat.addClass('osc-embed-progress-heartbeat--changing');
          requestAnimationFrame(() => {
            heartbeat.setText(filename);
            heartbeat.style.display = '';
            requestAnimationFrame(() => heartbeat.removeClass('osc-embed-progress-heartbeat--changing'));
          });
          previousFilename = filename;
        } else if (!filename) {
          heartbeat.style.display = 'none';
        }
        break;
      }

      case 3:
        labelEl.setText('\u2713 Vault indexed');
        countEl.setText(`${notesTotal.toLocaleString()} notes`);
        bar.setValue(100);
        pctEl.setText('100%');
        heartbeat.setText('');
        heartbeat.style.display = 'none';

        if (!completionTimer) {
          wrapper.addClass('osc-embed-progress--complete');
          completionTimer = setTimeout(destroy, COMPLETION_VISIBLE_MS + COMPLETION_FADE_MS);
        }
        break;
    }

    wrapper.setAttribute(
      'title',
      `Notes: ${notesEmbedded.toLocaleString()}/${notesTotal.toLocaleString()} | Blocks: ${embeddedBlocks.toLocaleString()}/${totalBlocks.toLocaleString()}`,
    );
  }

  update();

  return { update, destroy };
}
