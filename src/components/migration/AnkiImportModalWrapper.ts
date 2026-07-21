import { App, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import AnkiImportUI from "./AnkiImportUI.svelte";
import type { SrMigrationComponent } from "../../types/svelte-components";
import type { AnkiImportController } from "@/services/AnkiImportController";
import type { IDatabaseService } from "@/database/DatabaseFactory";
import { makeModalResponsive, type ResponsiveModalHandle } from "../../utils/responsive-modal";

export class AnkiImportModalWrapper extends Modal {
  private component: SrMigrationComponent | null = null;
  private responsiveHandle?: ResponsiveModalHandle;

  constructor(
    app: App,
    private readonly db: IDatabaseService,
    private readonly controller: AnkiImportController,
    private readonly onComplete: () => Promise<void>
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    this.responsiveHandle = makeModalResponsive(this);
    contentEl.addClass("decks-sr-migration-container");

    this.component = mount(AnkiImportUI, {
      target: contentEl,
      props: {
        db: this.db,
        controller: this.controller,
        onComplete: () => {
          void this.onComplete();
        },
        oncancel: () => this.close(),
      },
    }) as SrMigrationComponent;
  }

  onClose() {
    this.responsiveHandle?.dispose();
    this.responsiveHandle = undefined;
    if (this.component) {
      void unmount(this.component);
      this.component = null;
    }
    this.contentEl.empty();
  }
}
