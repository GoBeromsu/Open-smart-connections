import { FuzzySuggestModal, type App } from 'obsidian';

export class FolderExclusionPickerModal extends FuzzySuggestModal<string> {
  private resolvePromise!: (value: string | null) => void;
  private resolved = false;

  constructor(
    app: App,
    private readonly folderPaths: string[],
  ) {
    super(app);
    this.setPlaceholder('Type to search vault folders…');
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolvePromise(null);
      this.resolved = true;
    }
    super.onClose();
  }

  openModal(): Promise<string | null> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      super.open();
    });
  }

  getItems(): string[] {
    return this.folderPaths;
  }

  getItemText(folderPath: string): string {
    return folderPath;
  }

  onChooseItem(folderPath: string): void {
    this.resolved = true;
    this.resolvePromise(folderPath);
  }
}
