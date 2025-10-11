import { Modal } from "obsidian";
import type { StatisticsService } from "../../services/StatisticsService";
import type { StatisticsComponent } from "../../types/svelte-components";
import type { DecksSettings } from "../../settings";
import StatisticsUI from "../statistics/StatisticsUI.svelte";
import { Logger } from "@/utils/logging";

export class StatisticsModal extends Modal {
    private statisticsService: StatisticsService;
    private settings: DecksSettings;
    private deckFilter?: string;
    private component: StatisticsComponent | null = null;
    private resizeHandler?: () => void;
    private logger: Logger;

    constructor(
        app: any,
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
                statisticsService: this.statisticsService,
                settings: this.settings,
                logger: this.logger,
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
