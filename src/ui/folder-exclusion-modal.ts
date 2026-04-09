import { ButtonComponent, Modal, Setting, type App } from 'obsidian';

export class FolderExclusionPickerModal extends Modal {
  private resolvePromise!: (value: string | null) => void;
  private searchValue = '';
  private resolved = false;

  constructor(
    app: App,
    private readonly folderPaths: string[],
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: 'Select folder to exclude' });

    const searchSetting = new Setting(contentEl)
      .setName('Find folder')
      .setDesc('Choose a folder path from the current vault.');

    searchSetting.addText((text) => {
      text.setPlaceholder('Type to filter folders');
      text.onChange((value) => {
        this.searchValue = value.trim().toLowerCase();
        this.renderFolderList();
      });
    });

    contentEl.createDiv({ cls: 'osc-folder-picker-list' });
    this.renderFolderList();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolvePromise(null);
      this.resolved = true;
    }
  }

  openModal(): Promise<string | null> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      super.open();
    });
  }

  private renderFolderList(): void {
    const list = this.contentEl.querySelector<HTMLElement>('.osc-folder-picker-list');
    if (!list) return;
    list.empty();

    const folders = this.folderPaths.filter((path) => {
      if (!this.searchValue) return true;
      return path.toLowerCase().includes(this.searchValue);
    });

    if (folders.length === 0) {
      list.createEl('p', { text: 'No matching folders found.', cls: 'setting-item-description' });
      return;
    }

    for (const folderPath of folders) {
      new Setting(list)
        .setName(folderPath)
        .addButton((button) => {
          button
            .setButtonText('Select')
            .setCta()
            .onClick(() => {
              this.resolved = true;
              this.resolvePromise(folderPath);
              this.close();
            });
        });
    }

    const footer = list.createDiv({ cls: 'modal-button-container' });
    new ButtonComponent(footer)
      .setButtonText('Cancel')
      .onClick(() => {
        this.resolved = true;
        this.resolvePromise(null);
        this.close();
      });
  }
}
