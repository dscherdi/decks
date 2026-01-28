import type { Deck, DeckWithProfile, DeckStats, DeckGroup } from "@/database/types";
import { VIEW_TYPE_DECKS } from "@/main";
import { DeckSynchronizer } from "@/services/DeckSynchronizer";
import { DeckManager } from "@/services/DeckManager";
import type { DecksSettings } from "@/settings";
import { yieldToUI } from "@/utils/ui";
import { Logger } from "@/utils/logging";
import { ItemView, Component, WorkspaceLeaf, Notice } from "obsidian";
import { Scheduler } from "@/services/Scheduler";
import { FlashcardReviewModalWrapper } from "./review/FlashcardReviewModalWrapper";
import { StatisticsModal } from "./settings/StatisticsModal";
import { ProfilesManagerModal } from "./config/ProfilesManagerModal";
import { DeckConfigModal } from "./config/DeckConfigModal";
import { StatisticsService } from "@/services/StatisticsService";
import { TagGroupService } from "@/services/TagGroupService";

import DeckListPanel from "./DeckListPanel.svelte";
import { mount, unmount } from "svelte";
import { ProgressTracker } from "@/utils/progress";
import type { DeckListPanelComponent } from "../types/svelte-components";
import type { IDatabaseService } from "../database/DatabaseFactory";

export class DecksView extends ItemView {
  private db: IDatabaseService;
  private deckSynchronizer: DeckSynchronizer;
  private deckManager: DeckManager;
  private scheduler: Scheduler;
  private statisticsService: StatisticsService;
  private tagGroupService: TagGroupService;
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
    database: IDatabaseService,
    deckSynchronizer: DeckSynchronizer,
    deckManager: DeckManager,
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
    this.deckManager = deckManager;
    this.scheduler = scheduler;
    this.statisticsService = statisticsService;
    this.tagGroupService = new TagGroupService(database);
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

    // Create and mount Svelte component using Svelte 5 API
    this.deckListPanelComponent = mount(DeckListPanel, {
      target: container as HTMLElement,
      props: {
        statisticsService: this.statisticsService,
        db: this.db,
        deckSynchronizer: this.deckSynchronizer,
        tagGroupService: this.tagGroupService,
        app: this.app,
        onDeckClick: (deck: DeckWithProfile) => this.startReview(deck),
        onDeckGroupClick: (deckGroup: DeckGroup) => this.startReviewForDeckGroup(deckGroup),
        onRefresh: () => this.refresh(false),
        onForceRefreshDeck: async (deckId: string) => {
          await this.deckSynchronizer.forceSyncDeck(deckId);
          await this.refreshStats();
        },
        openStatisticsModal: () => this.openStatisticsModal(),
        openProfilesManagerModal: () => this.openProfilesManagerModal(),
        openDeckConfigModal: (deck: DeckWithProfile) => this.openDeckConfigModal(deck),
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
      // Svelte 5: explicitly unmount to trigger onDestroy and cleanup listeners
      try {
        await unmount(this.deckListPanelComponent);
      } catch (e) {
        console.warn("Error unmounting deck list panel:", e);
      }
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

  async update(updatedDecks: DeckWithProfile[], deckStats: Map<string, DeckStats>) {
    await this.deckListPanelComponent?.updateAll?.(updatedDecks, deckStats);
  }

  private async getAllDeckStatsMap(): Promise<Map<string, DeckStats>> {
    return await this.deckManager.getAllDeckStatsMap();
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

  openProfilesManagerModal(): void {
    new ProfilesManagerModal(
      this.app,
      this.db,
      async () => {
        // Refresh decks after profiles changed
        await this.refresh(false);
      }
    ).open();
  }

  openDeckConfigModal(deck: DeckWithProfile): void {
    new DeckConfigModal(
      this.app,
      deck,
      this.db,
      this.deckSynchronizer,
      async (deckId: string) => {
        // Refresh stats for this deck after config changes
        await this.refreshStatsById(deckId);
      }
    ).open();
  }

  async refresh(force = false) {
    this.logger.debug("DecksView.refresh() called");
    try {
      // Perform sync with force parameter
      await this.deckSynchronizer.performSync(force);

      // Update the view with refreshed data
      const updatedDecks = await this.db.getAllDecksWithProfiles();
      const deckStats = await this.getAllDeckStatsMap();
      await this.update(updatedDecks, deckStats);

      this.logger.debug("Refresh complete");
    } catch (error) {
      this.logger.error("Error refreshing decks:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice("Error refreshing decks. Check console for details.");
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
        await this.deckListPanelComponent.updateAll?.(undefined, deckStats);
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
      const deckStats = await this.deckManager.getDeckStats(deckId);
      this.logger.debug("Updated deck stats for:", deckId);

      // Update component using unified function
      if (this.deckListPanelComponent && deckStats) {
        await this.deckListPanelComponent.updateAll?.(
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

    this.backgroundRefreshInterval = setInterval(() => {
      this.logger.debug("Background refresh tick");
      void this.refresh();
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
    await this.deckListPanelComponent?.updateAll?.();
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
      this.logger.debug(`Syncing cards for deck before review: ${deck.name}`);
      await this.deckSynchronizer.syncDeck(deck.id);
      await yieldToUI();
      // Get daily review counts to show remaining allowance
      const dailyCounts = await this.db.getDailyReviewCounts(deck.id, this.settings.review.nextDayStartsAt);

      // Calculate remaining daily allowance
      const deckWithProfile = await this.db.getDeckWithProfile(deck.id);
      if (!deckWithProfile) {
        throw new Error(`Deck not found: ${deck.id}`);
      }
      const profile = deckWithProfile.profile;
      const remainingNew = profile.hasNewCardsLimitEnabled
        ? profile.newCardsPerDay === 0
          ? "none"
          : Math.max(0, profile.newCardsPerDay - dailyCounts.newCount)
        : "unlimited";
      const remainingReview = profile.hasReviewCardsLimitEnabled
        ? profile.reviewCardsPerDay === 0
          ? "none"
          : Math.max(0, profile.reviewCardsPerDay - dailyCounts.reviewCount)
        : "unlimited";

      // Check if there are any cards available using the scheduler
      const nextCard = await this.scheduler.getNext(new Date(), deck.id, {
        allowNew: true,
      });

      if (!nextCard) {
        let message = `No cards due for review in ${deck.name}`;

        // Check if limits are the reason no cards are available
        const newLimitReached =
          profile.hasNewCardsLimitEnabled &&
          (remainingNew === 0 || remainingNew === "none");
        const reviewLimitReached =
          profile.hasReviewCardsLimitEnabled &&
          (remainingReview === 0 || remainingReview === "none");

        if (newLimitReached && reviewLimitReached) {
          message += `\n\nDaily limits reached:`;
          message += `\nNew cards: ${profile.newCardsPerDay}/${profile.newCardsPerDay}`;
          message += `\nReview cards: ${profile.reviewCardsPerDay}/${profile.reviewCardsPerDay}`;
        } else if (newLimitReached) {
          message += `\n\nDaily new cards limit reached: ${profile.newCardsPerDay}/${profile.newCardsPerDay}`;
        } else if (reviewLimitReached) {
          message += `\n\nDaily review cards limit reached: ${profile.reviewCardsPerDay}/${profile.reviewCardsPerDay}`;
        }

        if (this.settings?.ui?.enableNotices !== false) {
          new Notice(message);
        }
        return;
      }

      // Show daily limit info before starting review if limits are active
      if (profile.hasNewCardsLimitEnabled || profile.hasReviewCardsLimitEnabled) {
        let limitInfo = `Daily progress for ${deck.name}:\n`;
        if (profile.hasNewCardsLimitEnabled) {
          if (profile.newCardsPerDay === 0) {
            limitInfo += `New cards: DISABLED (0 allowed per day)\n`;
          } else if (dailyCounts.newCount >= profile.newCardsPerDay) {
            limitInfo += `New cards: ${dailyCounts.newCount}/${profile.newCardsPerDay} (LIMIT EXCEEDED)\n`;
          } else {
            limitInfo += `New cards: ${dailyCounts.newCount}/${profile.newCardsPerDay} (${remainingNew} remaining)\n`;
          }
        }
        if (profile.hasReviewCardsLimitEnabled) {
          if (profile.reviewCardsPerDay === 0) {
            limitInfo += `Review cards: DISABLED (0 allowed per day)\n`;
          } else if (dailyCounts.reviewCount >= profile.reviewCardsPerDay) {
            limitInfo += `Review cards: ${dailyCounts.reviewCount}/${profile.reviewCardsPerDay} (LIMIT EXCEEDED)\n`;
          } else {
            limitInfo += `Review cards: ${dailyCounts.reviewCount}/${profile.reviewCardsPerDay} (${remainingReview} remaining)\n`;
          }
        }

        // Add explanation when limits are exceeded but learning cards are available
        const newLimitExceeded =
          profile.hasNewCardsLimitEnabled &&
          (profile.newCardsPerDay === 0 ||
            dailyCounts.newCount >= profile.newCardsPerDay);
        const reviewLimitExceeded =
          profile.hasReviewCardsLimitEnabled &&
          (profile.reviewCardsPerDay === 0 ||
            dailyCounts.reviewCount >= profile.reviewCardsPerDay);

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

  async startReviewForDeckGroup(deckGroup: DeckGroup) {
    try {
      this.logger.debug(`Starting review for deck group: ${deckGroup.name}`);

      // Sync all decks in the group
      for (const deckId of deckGroup.deckIds) {
        await this.deckSynchronizer.syncDeck(deckId);
        await yieldToUI();
      }

      // Check for available cards
      const nextCard = await this.scheduler.getNextForDeckGroup(
        new Date(),
        deckGroup,
        { allowNew: true }
      );

      if (!nextCard) {
        if (this.settings?.ui?.enableNotices !== false) {
          new Notice(
            `No cards due in "${deckGroup.name}" (${deckGroup.deckIds.length} files)`
          );
        }
        return;
      }

      // Open review modal with deck group
      new FlashcardReviewModalWrapper(
        this.app,
        deckGroup,
        [nextCard],
        this.scheduler,
        this.settings,
        this.db,
        this.refresh.bind(this),
        this.refreshStatsById.bind(this)
      ).open();
    } catch (error) {
      console.error("Error starting deck group review:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice("Error starting review. Check console for details.");
      }
    }
  }
}
