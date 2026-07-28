import { Modal, App } from "obsidian";
import type { StatisticsService } from "../../services/StatisticsService";
import type { StatisticsComponent } from "../../types/svelte-components";
import type { DecksSettings } from "../../settings";
import StatisticsUI from "../statistics/StatisticsUI.svelte";
import { mount, unmount } from "svelte";
import { Logger } from "@/utils/logging";
import { makeModalResponsive, type ResponsiveModalHandle } from "../../utils/responsive-modal";

export class StatisticsModal extends Modal {
  private statisticsService: StatisticsService;
  private settings: DecksSettings;
  private deckFilter?: string;
  private component: StatisticsComponent | null = null;
  private logger: Logger;
  private responsiveHandle?: ResponsiveModalHandle;

  constructor(
    app: App,
    statisticsService: StatisticsService,
    settings: DecksSettings,
    logger: Logger,
    deckFilter?: string
  ) {
    super(app);
    this.statisticsService = statisticsService;
    this.settings = settings;
    this.logger = logger;
    this.deckFilter = deckFilter;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    this.responsiveHandle = makeModalResponsive(this);

    this.containerEl.addClass("decks-statistics-modal-container");
    contentEl.addClass("decks-statistics-modal-content");

    // Mount Svelte component using Svelte 5 API
    this.component = mount(StatisticsUI, {
      target: contentEl,
      props: {
        statisticsService: this.statisticsService,
        logger: this.logger,
        deckFilter: this.deckFilter,
        onClose: () => {
          this.close();
        },
      },
    }) as StatisticsComponent;
  }

  onClose() {
    const { contentEl } = this;

    this.responsiveHandle?.dispose();
    this.responsiveHandle = undefined;

    // Clean up Svelte component
    if (this.component) {
      try {
        void unmount(this.component);
      } catch (e) {
        console.warn("Error unmounting statistics component:", e);
      }
      this.component = null;
    }

    contentEl.empty();
  }
}
