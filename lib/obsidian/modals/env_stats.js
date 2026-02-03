import { Modal } from 'obsidian';

export class EnvStatsModal extends Modal {
  constructor(app, env) {
    super(app);
    this.env = env;
  }
  onOpen() {
    this.titleEl.setText("Smart Environment");
    this.contentEl.empty();
    this.contentEl.createEl('p', { text: 'Loading stats...' });
    setTimeout(this.render.bind(this), 100); // setTimeout to prevent blocking UI
  }
  async render() {
    const frag = await this.env.render_component("env_stats", this.env);
    this.contentEl.empty();
    if (frag) {
      this.contentEl.appendChild(frag);
    }else{
      this.contentEl.createEl('p', { text: 'Failed to load stats.' });
    }
  }
}
