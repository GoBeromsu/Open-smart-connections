import type { App } from 'obsidian';

export function parse_key_to_link(key: string): string {
  if (!key) return '';
  const [file_path, ...parts] = key.split('#');
  const file_name = file_path.split('/').pop()?.replace(/\\.md$/, '') ?? '';
  if (!parts.length) return `[[${file_name}]]`;
  const heading = parts.filter((part) => !part.startsWith('{')).pop();
  if (!heading) return `[[${file_name}]]`;
  return `[[${file_name}#${heading}]]`;
}

export function handle_drag_result(app: App, event: DragEvent, key: string): void {
  const drag_manager = (app as any).dragManager;
  if (!drag_manager) return;
  const link_text = parse_key_to_link(key);
  const drag_data = drag_manager.dragLink(event, link_text);
  drag_manager.onDragStart(event, drag_data);
}
