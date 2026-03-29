import { App, ButtonComponent, Modal } from 'obsidian';

class ConfirmModal extends Modal {
  result = false;
  private resolvePromise!: (value: boolean) => void;

  constructor(app: App, private readonly message: string) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('p', { text: this.message });

    const buttonDiv = contentEl.createDiv({ cls: 'modal-button-container' });
    new ButtonComponent(buttonDiv).setButtonText('Cancel').onClick(() => {
      this.result = false;
      this.close();
    });
    new ButtonComponent(buttonDiv).setButtonText('Confirm').setCta().onClick(() => {
      this.result = true;
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolvePromise(this.result);
  }

  openModal(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      super.open();
    });
  }
}

export async function confirmWithModal(app: App, message: string): Promise<boolean> {
  return new ConfirmModal(app, message).openModal();
}
