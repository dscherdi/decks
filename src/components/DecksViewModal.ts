import type {
  DeckWithProfile,
  DeckStats,
  DeckGroup,
  Flashcard,
  DeckOrGroup,
  CustomDeckGroup,
  FilterDefinition,
} from "@/database/types";
import { DeckSynchronizer } from "@/services/DeckSynchronizer";
import { DeckManager } from "@/services/DeckManager";
import type { DecksSettings } from "@/settings";
import { I18n, yieldToUI } from "@decks/core";
import { Logger } from "@/utils/logging";
import { Modal, Notice, WorkspaceLeaf } from "obsidian";
import type { App } from "obsidian";
import { Scheduler } from "@decks/core";
import { FlashcardReviewModalWrapper } from "./review/FlashcardReviewModalWrapper";
import {
  FlashcardReviewView,
  VIEW_TYPE_FLASHCARD_REVIEW,
} from "./review/FlashcardReviewView";
import { StatisticsModal } from "./settings/StatisticsModal";
import { ProfilesManagerModal } from "./config/ProfilesManagerModal";
import { DeckConfigModal } from "./config/DeckConfigModal";
import { StatisticsService } from "@/services/StatisticsService";
import { TagGroupService } from "@decks/core";
import { CustomDeckService } from "@decks/core";
import { FlashcardManagerModal } from "./FlashcardManagerModal";
import { openFlashcardManager } from "./FlashcardManagerView";

import DeckListPanel from "./DeckListPanel.svelte";
import { mount, unmount } from "svelte";
import type { DeckListPanelComponent } from "../types/svelte-components";
import type { IDatabaseService } from "../database/DatabaseFactory";
import type { DecksView } from "./DecksView";
import type { DeckListSortMode } from "@/settings";

export class DecksViewModal extends Modal {
  private db: IDatabaseService;
  private deckSynchronizer: DeckSynchronizer;
  private deckManager: DeckManager;
  private scheduler: Scheduler;
  private statisticsService: StatisticsService;
  private tagGroupService: TagGroupService;
  private customDeckService: CustomDeckService;
  private settings: DecksSettings;
  private logger: Logger;
  private deckListPanelComponent: DeckListPanelComponent | null = null;
  private resizeHandler?: () => void;
  private getDecksView: () => DecksView | null;
  private saveSettings: () => Promise<void>;
  private openEditModal?: (card: Flashcard) => Promise<void>;
  private openBatchRefactor?: (cards: Flashcard[]) => Promise<void>;
  private openAiGenerator?: () => void;
  private openAnkiImport?: () => void;

  constructor(
    app: App,
    db: IDatabaseService,
    deckSynchronizer: DeckSynchronizer,
    deckManager: DeckManager,
    scheduler: Scheduler,
    statisticsService: StatisticsService,
    customDeckService: CustomDeckService,
    settings: DecksSettings,
    logger: Logger,
    getDecksView: () => DecksView | null,
    saveSettings: () => Promise<void>,
    openEditModal?: (card: Flashcard) => Promise<void>,
    openBatchRefactor?: (cards: Flashcard[]) => Promise<void>,
    openAiGenerator?: () => void,
    openAnkiImport?: () => void,
  ) {
    super(app);
    this.db = db;
    this.deckSynchronizer = deckSynchronizer;
    this.deckManager = deckManager;
    this.scheduler = scheduler;
    this.statisticsService = statisticsService;
    this.tagGroupService = new TagGroupService(db);
    this.customDeckService = customDeckService;
    this.settings = settings;
    this.logger = logger;
    this.getDecksView = getDecksView;
    this.saveSettings = saveSettings;
    this.openEditModal = openEditModal;
    this.openBatchRefactor = openBatchRefactor;
    this.openAiGenerator = openAiGenerator;
    this.openAnkiImport = openAnkiImport;
  }

  private async togglePin(id: string): Promise<void> {
    const set = new Set(this.settings.ui.pinnedDeckIds);
    if (!set.delete(id)) set.add(id);
    this.settings.ui.pinnedDeckIds = [...set];
    await this.saveSettings();
    this.deckListPanelComponent?.updatePinnedIds?.(
      this.settings.ui.pinnedDeckIds,
    );
    // Also push into the sidepanel if it's open so both views stay in sync.
    this.getDecksView()?.applyPinnedIdsUpdate(this.settings.ui.pinnedDeckIds);
  }

  private async changeSortMode(mode: DeckListSortMode): Promise<void> {
    this.settings.ui.deckListSort = mode;
    await this.saveSettings();
    this.deckListPanelComponent?.updateSortMode?.(mode);
    this.getDecksView()?.applySortModeUpdate(mode);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const modalEl = this.containerEl.querySelector(".modal");
    if (modalEl instanceof HTMLElement) {
      modalEl.addClass("decks-modal");
      if (window.innerWidth <= 768) {
        modalEl.addClass("decks-modal-mobile");
      } else {
        modalEl.removeClass("decks-modal-mobile");
      }
    }

    contentEl.addClass("decks-decks-view-container");

    this.deckListPanelComponent = mount(DeckListPanel, {
      target: contentEl,
      props: {
        statisticsService: this.statisticsService,
        db: this.db,
        deckSynchronizer: this.deckSynchronizer,
        tagGroupService: this.tagGroupService,
        app: this.app,
        onDeckClick: (deck: DeckWithProfile) => {
          void this.startReview(deck);
        },
        onDeckGroupClick: (deckGroup: DeckGroup) => {
          void this.startReviewForDeckGroup(deckGroup);
        },
        onBrowseDeck: (deck: DeckWithProfile) => {
          void this.startBrowse(deck);
        },
        onBrowseDeckGroup: (deckGroup: DeckGroup) => {
          void this.startBrowseForDeckGroup(deckGroup);
        },
        onCustomDeckClick: (customDeck: CustomDeckGroup) => {
          void this.startReviewForCustomDeck(customDeck);
        },
        onBrowseCustomDeck: (customDeck: CustomDeckGroup) => {
          void this.startBrowseForCustomDeck(customDeck);
        },
        onEditCustomDeck: (customDeck: CustomDeckGroup) => {
          this.openEditCustomDeck(customDeck);
        },
        customDeckService: this.customDeckService,
        onRefresh: () => this.refresh(),
        openStatisticsModal: () => this.openStatisticsModal(),
        openProfilesManagerModal: () => this.openProfilesManagerModal(),
        openDeckConfigModal: (deck: DeckWithProfile) =>
          this.openDeckConfigModal(deck),
        openFlashcardManager: () => this.openFlashcardManager(),
        openAiGeneratorModal: () => this.openAiGenerator?.(),
        openAnkiImportModal: () => this.openAnkiImport?.(),
        aiEnabled: this.settings.ai.enabled,
        deckTag: this.settings.parsing.deckTag,
        pinnedDeckIds: this.settings.ui.pinnedDeckIds,
        onTogglePin: (id: string) => this.togglePin(id),
        deckListSort: this.settings.ui.deckListSort,
        minDeckCardCount: this.settings.ui.minDeckCardCount,
        onChangeSortMode: (mode: DeckListSortMode) => this.changeSortMode(mode),
      },
    }) as DeckListPanelComponent;

    void this.refresh();

    const handleResize = () => {
      const el = this.containerEl.querySelector(".modal");
      if (el instanceof HTMLElement) {
        if (window.innerWidth <= 768) {
          el.addClass("decks-modal-mobile");
        } else {
          el.removeClass("decks-modal-mobile");
        }
      }
    };
    window.addEventListener("resize", handleResize);
    this.resizeHandler = handleResize;
  }

  onClose() {
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = undefined;
    }

    if (this.deckListPanelComponent) {
      void unmount(this.deckListPanelComponent);
      this.deckListPanelComponent = null;
    }

    const { contentEl } = this;
    contentEl.empty();
  }

  /**
   * Open a child modal that should return focus to us when it closes.
   *
   * Previous impl closed+recreated this modal on every child close, which
   * (a) made the user see a flash of the sidepanel underneath while the
   * recreate happened, and (b) destroyed all our internal state (scroll
   * position, filter input, etc.). Now we just stack the child on top —
   * Obsidian's modal layering handles overlap natively — and on child
   * close we patch our existing panel from fresh DB state. No recreate,
   * no flash, no lost state.
   *
   * Exception: when a review's source-nav was triggered, the user wants
   * to read the source markdown file. We close ourselves so they have
   * the workspace fully visible.
   */
  private openWithReturn(childModal: Modal) {
    const originalOnClose = childModal.onClose.bind(childModal);
    childModal.onClose = () => {
      originalOnClose();
      const isSourceNav =
        childModal instanceof FlashcardReviewModalWrapper &&
        childModal.navigatedToSource;
      if (isSourceNav) {
        this.close();
        return;
      }
      // Patch our panel from current DB state. skipSync because a sync
      // ran when we first opened — the only DB changes since then are
      // local rate ops from the child, which we already wrote synchronously.
      void this.refresh({ skipSync: true });
    };
    childModal.open();
  }

  /**
   * Stale-while-revalidate refresh. Stage 1 paints from DB instantly so
   * the user sees their decks within one DB round-trip. Stage 2 runs the
   * sync in the background and re-paints if anything changed. The sync
   * is skipped entirely when one just completed (returning from a review
   * is the canonical case — review takes far longer than the 2s window).
   */
  private async refresh(options: { skipSync?: boolean } = {}): Promise<void> {
    try {
      // Stage 1: instant paint.
      const initialDecks = await this.db.getAllDecksWithProfiles();
      const initialStats = await this.getAllDeckStatsMap();
      await this.deckListPanelComponent?.updateAll?.(initialDecks, initialStats);
    } catch (error) {
      this.logger.error("Error painting initial deck state in modal:", error);
      return;
    }

    if (options.skipSync) return;
    // Skip sync if one completed very recently (review return-trip path).
    const sinceLastSync = Date.now() - this.deckSynchronizer.lastSyncCompletedAt;
    if (sinceLastSync >= 0 && sinceLastSync < 2000) {
      this.logger.debug(`Skipping sync — completed ${sinceLastSync}ms ago`);
      return;
    }

    void this.runBackgroundSync();
  }

  private backgroundSyncInFlight = false;

  private async runBackgroundSync(): Promise<void> {
    if (this.backgroundSyncInFlight) return;
    this.backgroundSyncInFlight = true;
    try {
      this.deckListPanelComponent?.setSyncing?.(true);
      await this.deckSynchronizer.performSync();
      const decks = await this.db.getAllDecksWithProfiles();
      const stats = await this.getAllDeckStatsMap();
      await this.deckListPanelComponent?.updateAll?.(decks, stats);
    } catch (error) {
      this.logger.error("Background sync failed in modal:", error);
    } finally {
      this.deckListPanelComponent?.setSyncing?.(false);
      this.backgroundSyncInFlight = false;
    }
  }

  private async getAllDeckStatsMap(): Promise<Map<string, DeckStats>> {
    return await this.deckManager.getAllDeckStatsMap();
  }

  /**
   * Refresh both our own modal panel AND the sidepanel view (for users
   * who keep the leaf view open). Called from the review modal on
   * onCardReviewed / onComplete — the review wrapper passes a bound
   * reference, so this fires while the review is open on top of us.
   */
  private async refreshDecksAndStats() {
    // Our own panel first so the modal's heatmap and stats reflect the
    // review live (the user can swipe past the review to peek at the
    // deck list underneath, or see updates the moment review closes).
    if (this.deckListPanelComponent) {
      try {
        const decks = await this.db.getAllDecksWithProfiles();
        const stats = await this.getAllDeckStatsMap();
        await this.deckListPanelComponent.updateAll?.(decks, stats);
      } catch (error) {
        this.logger.debug("Failed to refresh modal panel:", error);
      }
    }
    const view = this.getDecksView();
    if (view) {
      await view.refreshDecksAndStats();
    }
  }

  private async refreshStatsById(deckId: string) {
    // Single-deck patch on our own panel — the keyed {#each} lets Svelte
    // update just that row without reflowing the rest of the list.
    if (this.deckListPanelComponent) {
      try {
        const customDeck = await this.db.getCustomDeckById(deckId);
        if (customDeck) {
          const stats = await this.customDeckService.getCustomDeckStats(deckId);
          this.deckListPanelComponent.updateCustomDeckStatsById?.(deckId, stats);
        } else {
          const stats = await this.deckManager.getDeckStats(deckId);
          await this.deckListPanelComponent.updateAll?.(
            undefined,
            undefined,
            deckId,
            stats
          );
        }
      } catch (error) {
        this.logger.debug("Failed to refresh modal panel stats:", error);
      }
    }
    const view = this.getDecksView();
    if (view) {
      await view.refreshStatsById(deckId);
    }
  }

  private openStatisticsModal(): void {
    const modal = new StatisticsModal(
      this.app,
      this.statisticsService,
      this.settings,
      this.logger
    );
    this.openWithReturn(modal);
  }

  private openProfilesManagerModal(): void {
    void this.db.getActiveTrainedWeightSet().then((active) => {
      const modal = new ProfilesManagerModal(
        this.app,
        this.db,
        async () => {
          const view = this.getDecksView();
          if (view) await view.refresh();
        },
        active !== null
      );
      this.openWithReturn(modal);
    });
  }

  private openDeckConfigModal(deck: DeckWithProfile): void {
    const modal = new DeckConfigModal(this.app, deck, this.db, async () => {
      const view = this.getDecksView();
      if (view) await view.refresh();
    });
    this.openWithReturn(modal);
  }

  private openFlashcardManager(): void {
    this.presentFlashcardManager(undefined);
  }


  private openEditCustomDeck(customDeck: CustomDeckGroup): void {
    if (customDeck.deckType === "filter") {
      const filterDefinition: FilterDefinition = customDeck.filterDefinition
        ? JSON.parse(customDeck.filterDefinition)
        : { version: 1, logic: "AND", rules: [] };
      this.presentFlashcardManager({
        kind: "filter",
        id: customDeck.id,
        name: customDeck.name,
        filterDefinition,
      });
    } else {
      this.presentFlashcardManager({
        kind: "manual",
        id: customDeck.id,
        name: customDeck.name,
      });
    }
  }

  // The modal path keeps the deck-list modal underneath via openWithReturn;
  // the tab path closes us first so the new tab is actually visible.
  private presentFlashcardManager(
    editTarget: import("./FlashcardManagerEditTypes").EditTarget | undefined,
  ): void {
    if (this.settings.ui.flashcardManagerDisplayMode === "tab") {
      this.close();
      openFlashcardManager(
        this.app,
        this.db,
        this.customDeckService,
        this.settings,
        editTarget,
        async () => {
          const view = this.getDecksView();
          if (view) await view.refresh();
        },
        async () => {
          await this.deckManager.cleanupOrphanedDecks();
        },
        (widths) => {
          this.settings.ui.managerColumnWidths = widths;
          void this.saveSettings();
        },
        this.openEditModal,
        this.openBatchRefactor,
      );
      return;
    }

    const thresholds = {
      leechThreshold: this.settings.review.leechThreshold,
      denseCardCharThreshold: this.settings.review.denseCardCharThreshold,
    };
    const modal = new FlashcardManagerModal(
      this.app,
      this.db,
      this.customDeckService,
      thresholds,
      editTarget,
      () => void this.refresh(),
      async () => {
        await this.deckManager.cleanupOrphanedDecks();
      },
      this.settings.ui.managerColumnWidths ?? {},
      (widths) => {
        this.settings.ui.managerColumnWidths = widths;
        void this.saveSettings();
      },
      this.openEditModal,
      this.settings,
      this.openBatchRefactor,
    );
    this.openWithReturn(modal);
  }

  private openReviewSession(
    deckOrGroup: DeckOrGroup,
    cards: Flashcard[],
    browseMode: boolean
  ): void {
    if (this.settings.ui.reviewDisplayMode === "tab") {
      this.close();
      this.openReviewInTab(deckOrGroup, cards, browseMode);
    } else {
      const reviewModal = new FlashcardReviewModalWrapper(
        this.app,
        deckOrGroup,
        cards,
        this.scheduler,
        this.settings,
        this.db,
        this.deckSynchronizer,
        this.refreshDecksAndStats.bind(this),
        this.refreshStatsById.bind(this),
        browseMode
      );
      this.openWithReturn(reviewModal);
    }
  }

  private openReviewInTab(
    deckOrGroup: DeckOrGroup,
    cards: Flashcard[],
    browseMode: boolean
  ): void {
    const { workspace } = this.app;
    const existingLeaves = workspace.getLeavesOfType(
      VIEW_TYPE_FLASHCARD_REVIEW
    );

    let leaf: WorkspaceLeaf;
    if (existingLeaves.length > 0) {
      leaf = existingLeaves[0];
    } else {
      leaf = workspace.getLeaf("tab");
    }

    void leaf
      .setViewState({
        type: VIEW_TYPE_FLASHCARD_REVIEW,
        active: true,
      })
      .then(() => {
        const view = leaf.view;
        if (view instanceof FlashcardReviewView) {
          view.setReviewData(
            deckOrGroup,
            cards,
            browseMode,
            this.refreshDecksAndStats.bind(this),
            this.refreshStatsById.bind(this),
            this.deckSynchronizer
          );
        }
        void workspace.revealLeaf(leaf);
      })
      .catch(console.error);
  }

  private async startReview(deck: DeckWithProfile) {
    try {
      this.logger.debug(`Syncing cards for deck before review: ${deck.name}`);
      await this.deckSynchronizer.syncDeck(deck.id);
      await yieldToUI();

      const dailyCounts = await this.db.getDailyReviewCounts(
        deck.id,
        this.settings.review.nextDayStartsAt
      );

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

      const nextCard = await this.scheduler.getNext(new Date(), deck.id, {
        allowNew: true,
      });

      if (!nextCard) {
        let message = I18n.format(I18n.t.notices.noCardsDueForReview, {
          deckName: deck.name,
        });

        const newLimitReached =
          profile.hasNewCardsLimitEnabled &&
          (remainingNew === 0 || remainingNew === "none");
        const reviewLimitReached =
          profile.hasReviewCardsLimitEnabled &&
          (remainingReview === 0 || remainingReview === "none");

        if (newLimitReached && reviewLimitReached) {
          message += I18n.t.notices.dailyLimitsReached;
          message += I18n.format(I18n.t.notices.dailyNewLimit, {
            used: profile.newCardsPerDay,
            max: profile.newCardsPerDay,
          });
          message += I18n.format(I18n.t.notices.dailyReviewLimit, {
            used: profile.reviewCardsPerDay,
            max: profile.reviewCardsPerDay,
          });
        } else if (newLimitReached) {
          message += I18n.format(I18n.t.notices.dailyNewOnlyLimit, {
            used: profile.newCardsPerDay,
            max: profile.newCardsPerDay,
          });
        } else if (reviewLimitReached) {
          message += I18n.format(I18n.t.notices.dailyReviewOnlyLimit, {
            used: profile.reviewCardsPerDay,
            max: profile.reviewCardsPerDay,
          });
        }

        if (this.settings?.ui?.enableNotices !== false) {
          new Notice(message);
        }
        return;
      }

      if (
        profile.hasNewCardsLimitEnabled ||
        profile.hasReviewCardsLimitEnabled
      ) {
        let limitInfo = I18n.format(I18n.t.notices.dailyProgressHeader, {
          deckName: deck.name,
        });
        if (profile.hasNewCardsLimitEnabled) {
          if (profile.newCardsPerDay === 0) {
            limitInfo += I18n.t.notices.dailyProgressNewDisabled;
          } else if (dailyCounts.newCount >= profile.newCardsPerDay) {
            limitInfo += I18n.format(I18n.t.notices.dailyProgressNewExceeded, {
              used: dailyCounts.newCount,
              max: profile.newCardsPerDay,
            });
          } else {
            limitInfo += I18n.format(I18n.t.notices.dailyProgressNewRemaining, {
              used: dailyCounts.newCount,
              max: profile.newCardsPerDay,
              remaining: remainingNew,
            });
          }
        }
        if (profile.hasReviewCardsLimitEnabled) {
          if (profile.reviewCardsPerDay === 0) {
            limitInfo += I18n.t.notices.dailyProgressReviewDisabled;
          } else if (dailyCounts.reviewCount >= profile.reviewCardsPerDay) {
            limitInfo += I18n.format(I18n.t.notices.dailyProgressReviewExceeded, {
              used: dailyCounts.reviewCount,
              max: profile.reviewCardsPerDay,
            });
          } else {
            limitInfo += I18n.format(I18n.t.notices.dailyProgressReviewRemaining, {
              used: dailyCounts.reviewCount,
              max: profile.reviewCardsPerDay,
              remaining: remainingReview,
            });
          }
        }

        const newLimitExceeded =
          profile.hasNewCardsLimitEnabled &&
          (profile.newCardsPerDay === 0 ||
            dailyCounts.newCount >= profile.newCardsPerDay);
        const reviewLimitExceeded =
          profile.hasReviewCardsLimitEnabled &&
          (profile.reviewCardsPerDay === 0 ||
            dailyCounts.reviewCount >= profile.reviewCardsPerDay);

        if (newLimitExceeded || reviewLimitExceeded) {
          limitInfo += I18n.t.notices.dailyProgressOnlyLearning;
        }

        if (this.settings?.ui?.enableNotices !== false) {
          new Notice(limitInfo, 5000);
        }
      }

      this.openReviewSession({ ...deck, type: "file" }, [nextCard], false);
    } catch (error) {
      console.error("Error starting review:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice(I18n.t.notices.errorStartingReview);
      }
    }
  }

  private async startReviewForDeckGroup(deckGroup: DeckGroup) {
    try {
      this.logger.debug(`Starting review for deck group: ${deckGroup.name}`);

      for (const deckId of deckGroup.deckIds) {
        await this.deckSynchronizer.syncDeck(deckId);
        await yieldToUI();
      }

      const nextCard = await this.scheduler.getNextForDeckGroup(
        new Date(),
        deckGroup,
        { allowNew: true }
      );

      if (!nextCard) {
        if (this.settings?.ui?.enableNotices !== false) {
          new Notice(
            I18n.format(I18n.t.notices.noCardsDueInGroup, {
              name: deckGroup.name,
              count: deckGroup.deckIds.length,
            })
          );
        }
        return;
      }

      this.openReviewSession(deckGroup, [nextCard], false);
    } catch (error) {
      console.error("Error starting deck group review:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice(I18n.t.notices.errorStartingReview);
      }
    }
  }

  private async startBrowse(deck: DeckWithProfile) {
    try {
      this.logger.debug(`Starting browse mode for deck: ${deck.name}`);
      await this.deckSynchronizer.syncDeck(deck.id);
      await yieldToUI();

      const allCards = await this.db.getFlashcardsByDeck(deck.id);

      if (allCards.length === 0) {
        if (this.settings?.ui?.enableNotices !== false) {
          new Notice(
            I18n.format(I18n.t.notices.noCardsFoundInDeck, { deckName: deck.name })
          );
        }
        return;
      }

      this.openReviewSession({ ...deck, type: "file" }, allCards, true);
    } catch (error) {
      console.error("Error starting browse:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice(I18n.t.notices.errorStartingBrowse);
      }
    }
  }

  private async startBrowseForDeckGroup(deckGroup: DeckGroup) {
    try {
      this.logger.debug(
        `Starting browse mode for deck group: ${deckGroup.name}`
      );

      for (const deckId of deckGroup.deckIds) {
        await this.deckSynchronizer.syncDeck(deckId);
        await yieldToUI();
      }

      const allCards: Flashcard[] = [];
      for (const deckId of deckGroup.deckIds) {
        const deckCards = await this.db.getFlashcardsByDeck(deckId);
        allCards.push(...deckCards);
      }

      if (allCards.length === 0) {
        if (this.settings?.ui?.enableNotices !== false) {
          new Notice(
            I18n.format(I18n.t.notices.noCardsFoundInGroup, { name: deckGroup.name })
          );
        }
        return;
      }

      this.openReviewSession(deckGroup, allCards, true);
    } catch (error) {
      console.error("Error starting deck group browse:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice(I18n.t.notices.errorStartingBrowse);
      }
    }
  }

  private async startReviewForCustomDeck(customDeck: CustomDeckGroup) {
    try {
      this.logger.debug(`Starting review for custom deck: ${customDeck.name}`);

      const nextCard = await this.scheduler.getNextForCustomDeck(
        new Date(),
        customDeck,
        { allowNew: true }
      );

      if (!nextCard) {
        if (this.settings?.ui?.enableNotices !== false) {
          new Notice(
            I18n.format(I18n.t.notices.noCardsDueInCustomDeck, {
              name: customDeck.name,
              count: customDeck.flashcardIds.length,
            })
          );
        }
        return;
      }

      this.openReviewSession(customDeck, [nextCard], false);
    } catch (error) {
      console.error("Error starting custom deck review:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice(I18n.t.notices.errorStartingReview);
      }
    }
  }

  private async startBrowseForCustomDeck(customDeck: CustomDeckGroup) {
    try {
      this.logger.debug(`Starting browse mode for custom deck: ${customDeck.name}`);

      const allCards = await this.db.getFlashcardsForCustomDeck(customDeck.id);

      if (allCards.length === 0) {
        if (this.settings?.ui?.enableNotices !== false) {
          new Notice(
            I18n.format(I18n.t.notices.noCardsFoundInGroup, { name: customDeck.name })
          );
        }
        return;
      }

      this.openReviewSession(customDeck, allCards, true);
    } catch (error) {
      console.error("Error starting custom deck browse:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice(I18n.t.notices.errorStartingBrowse);
      }
    }
  }
}
