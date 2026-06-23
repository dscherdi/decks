import { App, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import AnkiImportUI from "./AnkiImportUI.svelte";
import type { SrMigrationComponent } from "../../types/svelte-components";
import type { AnkiImportController } from "@/services/AnkiImportController";
import type { IDatabaseService } from "@/database/DatabaseFactory";

const MOBILE_BREAKPOINT = 768;

export class AnkiImportModalWrapper extends Modal {
  private component: SrMigrationComponent | null = null;
  private resizeHandler?: () => void;

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

    this.applyResponsiveClasses();
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

    this.resizeHandler = () => this.applyResponsiveClasses();
    window.addEventListener("resize", this.resizeHandler);
  }

  private applyResponsiveClasses(): void {
    const modalEl = this.containerEl.querySelector(".modal");
    if (modalEl instanceof HTMLElement) {
      modalEl.addClass("decks-modal");
      if (window.innerWidth <= MOBILE_BREAKPOINT) {
        modalEl.addClass("decks-modal-mobile");
      } else {
        modalEl.removeClass("decks-modal-mobile");
      }
    }
  }

  onClose() {
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = undefined;
    }
    if (this.component) {
      void unmount(this.component);
      this.component = null;
    }
    this.contentEl.empty();
  }
}
