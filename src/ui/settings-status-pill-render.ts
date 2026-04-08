export function renderStatusPill(
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

export function renderStatCard(
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

export function setElementText(element: HTMLElement, text: string): void {
  const target = element as HTMLElement & { setText?: (value: string) => void };
  if (typeof target.setText === 'function') {
    target.setText(text);
    return;
  }
  element.textContent = text;
}
