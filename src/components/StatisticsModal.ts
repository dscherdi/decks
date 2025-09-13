import { Modal } from "obsidian";
import type { DatabaseServiceInterface } from "../database/DatabaseFactory";
import type { StatisticsComponent } from "../types/svelte-components";
import StatisticsUI from "./StatisticsUI.svelte";

export class StatisticsModal extends Modal {
  private db: DatabaseServiceInterface;
  private deckFilter?: string;
  private component: StatisticsComponent | null = null;
  private resizeHandler?: () => void;

  constructor(app: any, db: DatabaseServiceInterface, deckFilter?: string) {
    super(app);
    this.db = db;
    this.deckFilter = deckFilter;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // Add CSS classes for styling
    const modalEl = this.containerEl.querySelector(".modal");
    if (modalEl instanceof HTMLElement) {
      modalEl.addClass("decks-modal");
      if (window.innerWidth <= 768) {
        modalEl.addClass("decks-modal-mobile");
      } else {
        modalEl.removeClass("decks-modal-mobile");
      }
    }

    this.containerEl.addClass("decks-statistics-modal-container");
    contentEl.addClass("decks-statistics-modal-content");

    // Mount Svelte component
    this.component = new StatisticsUI({
      target: contentEl,
      props: {
        db: this.db,
        deckFilter: this.deckFilter,
      },
    }) as StatisticsComponent;

    // Listen to component events
    this.component.$on("close", (event: any) => {
      this.close();
    });

    // Handle window resize for mobile adaptation
    const handleResize = () => {
      if (modalEl instanceof HTMLElement) {
        if (window.innerWidth <= 768) {
          modalEl.addClass("decks-modal-mobile");
        } else {
          modalEl.removeClass("decks-modal-mobile");
        }
      }
    };

    window.addEventListener("resize", handleResize);

    // Store resize handler for cleanup
    this.resizeHandler = handleResize;
  }

  onClose() {
    const { contentEl } = this;

    // Clean up resize handler
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = undefined;
    }

    // Destroy Svelte component
    if (this.component) {
      this.component.$destroy();
      this.component = null;
    }

    contentEl.empty();
  }
}
