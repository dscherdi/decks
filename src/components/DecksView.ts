import { DatabaseServiceInterface } from "@/database/DatabaseFactory";
import {
    Deck,
    DeckStats,
    DeckConfig,
    Flashcard,
    hasNewCardsLimit,
    hasReviewCardsLimit,
    ReviewSession,
    Statistics,
} from "@/database/types";
import { VIEW_TYPE_DECKS } from "@/main";
import { DeckSynchronizer } from "@/services/DeckSynchronizer";
import { DecksSettings } from "@/settings";
import { yieldToUI } from "@/utils/ui";
import { Logger, formatTime } from "@/utils/logging";
import { ItemView, Component, WorkspaceLeaf, Notice } from "obsidian";
import { Scheduler } from "@/services/Scheduler";
import { FlashcardReviewModalWrapper } from "./review/FlashcardReviewModalWrapper";
import { StatisticsModal } from "./settings/StatisticsModal";
import { StatisticsService } from "@/services/StatisticsService";
import { FSRS, type RatingLabel } from "@/algorithm/fsrs";
import DeckListPanel from "./DeckListPanel.svelte";
import { ProgressTracker } from "@/utils/progress";
import type { DeckListPanelComponent } from "../types/svelte-components";

export class DecksView extends ItemView {
    private db: DatabaseServiceInterface;
    private deckSynchronizer: DeckSynchronizer;
    private scheduler: Scheduler;
    private statisticsService: StatisticsService;
    private settings: DecksSettings;
    private setViewReference: (view: DecksView | null) => void;
    private deckListPanelComponent: DeckListPanelComponent | null = null;
    private markdownComponents: Component[] = [];
    private statsRefreshTimeout: NodeJS.Timeout | null = null;
    private backgroundRefreshInterval: NodeJS.Timeout | null = null;
    private progressTracker: ProgressTracker;
    private logger: Logger;

    constructor(
        leaf: WorkspaceLeaf,
        database: DatabaseServiceInterface,
        deckSynchronizer: DeckSynchronizer,
        scheduler: Scheduler,
        statisticsService: StatisticsService,
        settings: DecksSettings,
        progressTracker: ProgressTracker,
        logger: Logger,
        setViewReference: (view: DecksView | null) => void
    ) {
        super(leaf);
        this.db = database;
        this.deckSynchronizer = deckSynchronizer;
        this.scheduler = scheduler;
        this.statisticsService = statisticsService;
        this.settings = settings;
        this.logger = logger;

        this.progressTracker = progressTracker;

        this.setViewReference = setViewReference;
        // Set reference in plugin so we can access this view instance
        this.setViewReference(this);
    }

    getViewType(): string {
        return VIEW_TYPE_DECKS;
    }

    getDisplayText(): string {
        return "Decks";
    }

    getIcon(): string {
        return "brain";
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass("decks-view");

        // Create and mount Svelte component
        this.deckListPanelComponent = new DeckListPanel({
            target: container,
            props: {
                statisticsService: this.statisticsService,
                db: this.db,
                deckSynchronizer: this.deckSynchronizer,
                app: this.app,
                onDeckClick: (deck: Deck) => this.startReview(deck),
            },
        }) as DeckListPanelComponent;

        // Initial refresh
        await this.refresh(false);

        // Start background refresh job if enabled
        if (this.settings.ui.enableBackgroundRefresh) {
            this.startBackgroundRefresh();
        }
    }

    async onClose() {
        if (this.deckListPanelComponent) {
            this.deckListPanelComponent.$destroy();
            this.deckListPanelComponent = null;
        }

        // Clean up timeouts
        if (this.statsRefreshTimeout) {
            clearTimeout(this.statsRefreshTimeout);
            this.statsRefreshTimeout = null;
        }

        // Clean up background refresh
        this.stopBackgroundRefresh();

        // Clean up markdown components
        this.markdownComponents.forEach((comp) => comp.unload());
        this.markdownComponents = [];

        // Clear reference in plugin
        this.setViewReference(null);
    }

    async update(updatedDecks: Deck[], deckStats: Map<string, DeckStats>) {
        await this.deckListPanelComponent?.updateAll(updatedDecks, deckStats);
    }

    private async getAllDeckStatsMap(): Promise<Map<string, DeckStats>> {
        const stats = await this.statisticsService.getAllDeckStats();
        const statsMap = new Map<string, DeckStats>();
        for (const stat of stats) {
            statsMap.set(stat.deckId, stat);
        }
        return statsMap;
    }

    openStatisticsModal(deckFilter?: string): void {
        new StatisticsModal(
            this.app,
            this.statisticsService,
            this.settings,
            this.logger,
            deckFilter
        ).open();
    }

    async refresh(force: boolean = false) {
        this.logger.debug("DecksView.refresh() called");
        try {
            // Perform sync with force parameter
            await this.deckSynchronizer.performSync(force);

            // Update the view with refreshed data
            const updatedDecks = await this.db.getAllDecks();
            const deckStats = await this.getAllDeckStatsMap();
            this.update(updatedDecks, deckStats);

            this.logger.debug("Refresh complete");
        } catch (error) {
            this.logger.error("Error refreshing decks:", error);
            if (this.settings?.ui?.enableNotices !== false) {
                new Notice(
                    "Error refreshing decks. Check console for details."
                );
            }
        }
    }

    async refreshStats() {
        this.logger.debug("DecksView.refreshStats() executing");
        try {
            // Get updated stats only (faster than full refresh)
            const deckStats = await this.getAllDeckStatsMap();
            this.logger.debug("Updated deck stats:", deckStats);

            // Update component with new stats using unified function
            if (this.deckListPanelComponent) {
                await this.deckListPanelComponent.updateAll(
                    undefined,
                    deckStats
                );
            }
        } catch (error) {
            console.error("Error refreshing stats:", error);
        }
    }

    async refreshStatsById(deckId: string) {
        this.logger.debug(
            `DecksView.refreshStatsById() executing for deck: ${deckId}`
        );
        try {
            // Get stats for the specific deck
            const deckStats = await this.statisticsService.getDeckStats(deckId);
            this.logger.debug("Updated deck stats for:", deckId);

            // Update component using unified function
            if (this.deckListPanelComponent && deckStats) {
                await this.deckListPanelComponent.updateAll(
                    undefined,
                    undefined,
                    deckId,
                    deckStats
                );
            }
        } catch (error) {
            console.error("Error refreshing stats by ID:", error);
        }
    }

    startBackgroundRefresh() {
        // Don't start if background refresh is disabled
        if (!this.settings.ui.enableBackgroundRefresh) {
            return;
        }

        // Clear any existing interval
        this.stopBackgroundRefresh();

        this.logger.debug(
            `Starting background refresh job (every ${this.settings.ui.backgroundRefreshInterval} seconds)`
        );

        this.backgroundRefreshInterval = setInterval(async () => {
            this.logger.debug("Background refresh tick");
            this.refresh();
        }, this.settings.ui.backgroundRefreshInterval * 1000);
    }

    stopBackgroundRefresh() {
        if (this.backgroundRefreshInterval) {
            this.logger.debug("Stopping background refresh job");
            clearInterval(this.backgroundRefreshInterval);
            this.backgroundRefreshInterval = null;
        }
    }

    restartBackgroundRefresh() {
        this.stopBackgroundRefresh();
        if (this.settings.ui.enableBackgroundRefresh) {
            this.startBackgroundRefresh();
        }
    }

    async refreshHeatmap() {
        await this.deckListPanelComponent?.updateAll();
    }

    // Test method to check if background job is running
    checkBackgroundJobStatus() {
        this.logger.debug("Background job status:", {
            isRunning: !!this.backgroundRefreshInterval,
            intervalId: this.backgroundRefreshInterval,
            componentExists: !!this.deckListPanelComponent,
            refreshInterval: this.settings.ui.backgroundRefreshInterval,
        });
    }

    async startReview(deck: Deck) {
        try {
            // First sync flashcards for this specific deck
            this.logger.debug(
                `Syncing cards for deck before review: ${deck.name}`
            );
            await this.deckSynchronizer.syncDeck(deck.id);
            await yieldToUI();
            // Get daily review counts to show remaining allowance
            const dailyCounts = await this.db.getDailyReviewCounts(deck.id);

            // Calculate remaining daily allowance
            const config = deck.config;
            const remainingNew = hasNewCardsLimit(config)
                ? config.newCardsPerDay === 0
                    ? "none"
                    : Math.max(0, config.newCardsPerDay - dailyCounts.newCount)
                : "unlimited";
            const remainingReview = hasReviewCardsLimit(config)
                ? config.reviewCardsPerDay === 0
                    ? "none"
                    : Math.max(
                          0,
                          config.reviewCardsPerDay - dailyCounts.reviewCount
                      )
                : "unlimited";

            // Check if there are any cards available using the scheduler
            const nextCard = await this.scheduler.getNext(new Date(), deck.id, {
                allowNew: true,
            });

            if (!nextCard) {
                let message = `No cards due for review in ${deck.name}`;

                // Check if limits are the reason no cards are available
                const newLimitReached =
                    hasNewCardsLimit(config) &&
                    (remainingNew === 0 || remainingNew === "none");
                const reviewLimitReached =
                    hasReviewCardsLimit(config) &&
                    (remainingReview === 0 || remainingReview === "none");

                if (newLimitReached && reviewLimitReached) {
                    message += `\n\nDaily limits reached:`;
                    message += `\nNew cards: ${config.newCardsPerDay}/${config.newCardsPerDay}`;
                    message += `\nReview cards: ${config.reviewCardsPerDay}/${config.reviewCardsPerDay}`;
                } else if (newLimitReached) {
                    message += `\n\nDaily new cards limit reached: ${config.newCardsPerDay}/${config.newCardsPerDay}`;
                } else if (reviewLimitReached) {
                    message += `\n\nDaily review cards limit reached: ${config.reviewCardsPerDay}/${config.reviewCardsPerDay}`;
                }

                if (this.settings?.ui?.enableNotices !== false) {
                    new Notice(message);
                }
                return;
            }

            // Show daily limit info before starting review if limits are active
            if (hasNewCardsLimit(config) || hasReviewCardsLimit(config)) {
                let limitInfo = `Daily progress for ${deck.name}:\n`;
                if (hasNewCardsLimit(config)) {
                    if (config.newCardsPerDay === 0) {
                        limitInfo += `New cards: DISABLED (0 allowed per day)\n`;
                    } else if (dailyCounts.newCount >= config.newCardsPerDay) {
                        limitInfo += `New cards: ${dailyCounts.newCount}/${config.newCardsPerDay} (LIMIT EXCEEDED)\n`;
                    } else {
                        limitInfo += `New cards: ${dailyCounts.newCount}/${config.newCardsPerDay} (${remainingNew} remaining)\n`;
                    }
                }
                if (hasReviewCardsLimit(config)) {
                    if (config.reviewCardsPerDay === 0) {
                        limitInfo += `Review cards: DISABLED (0 allowed per day)\n`;
                    } else if (
                        dailyCounts.reviewCount >= config.reviewCardsPerDay
                    ) {
                        limitInfo += `Review cards: ${dailyCounts.reviewCount}/${config.reviewCardsPerDay} (LIMIT EXCEEDED)\n`;
                    } else {
                        limitInfo += `Review cards: ${dailyCounts.reviewCount}/${config.reviewCardsPerDay} (${remainingReview} remaining)\n`;
                    }
                }

                // Add explanation when limits are exceeded but learning cards are available
                const newLimitExceeded =
                    hasNewCardsLimit(config) &&
                    (config.newCardsPerDay === 0 ||
                        dailyCounts.newCount >= config.newCardsPerDay);
                const reviewLimitExceeded =
                    hasReviewCardsLimit(config) &&
                    (config.reviewCardsPerDay === 0 ||
                        dailyCounts.reviewCount >= config.reviewCardsPerDay);

                if (newLimitExceeded || reviewLimitExceeded) {
                    limitInfo += `\n\nNote: Only learning cards will be shown (limits exceeded)`;
                }

                if (this.settings?.ui?.enableNotices !== false) {
                    new Notice(limitInfo, 5000);
                }
            }

            // Open review modal
            new FlashcardReviewModalWrapper(
                this.app,
                deck,
                [nextCard],
                this.scheduler,
                this.settings,
                this.db,
                this.refresh.bind(this),
                this.refreshStatsById.bind(this)
            ).open();
        } catch (error) {
            console.error("Error starting review:", error);
            if (this.settings?.ui?.enableNotices !== false) {
                new Notice("Error starting review. Check console for details.");
            }
        }
    }
}
