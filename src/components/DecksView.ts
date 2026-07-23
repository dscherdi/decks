import type { DeckWithProfile, DeckStats, DeckGroup, Flashcard, DeckOrGroup, CustomDeckGroup, FilterDefinition } from "@/database/types";
import { VIEW_TYPE_DECKS } from "@/main";
import { DeckSynchronizer } from "@/services/DeckSynchronizer";
import { DeckManager } from "@/services/DeckManager";
import type { DecksSettings } from "@/settings";
import { I18n, yieldToUI } from "@decks/core";
import { Logger } from "@/utils/logging";
import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { Scheduler } from "@decks/core";
import { FlashcardReviewModalWrapper } from "./review/FlashcardReviewModalWrapper";
import {
  FlashcardReviewView,
  VIEW_TYPE_FLASHCARD_REVIEW,
} from "./review/FlashcardReviewView";
import { ExamAttempt, type DeckProfile } from "@decks/core";
import { launchExamForSelection } from "./exam/launchExam";
import { ExamModalWrapper } from "./exam/ExamModalWrapper";
import { ExamView, VIEW_TYPE_FLASHCARD_EXAM } from "./exam/ExamView";
import { StatisticsModal } from "./settings/StatisticsModal";
import { ProfilesManagerModal } from "./config/ProfilesManagerModal";
import { DeckConfigModal } from "./config/DeckConfigModal";
import { SrMigrationModalWrapper } from "./migration/SrMigrationModalWrapper";
import { SrMigrationController } from "@/services/SrMigrationController";
import { StatisticsService } from "@/services/StatisticsService";
import { TagGroupService } from "@decks/core";
import { CustomDeckService } from "@decks/core";
import { openFlashcardManager } from "./FlashcardManagerView";

import DeckListPanel from "./DeckListPanel.svelte";
import { mount, unmount } from "svelte";
import { ProgressTracker } from "@/utils/progress";
import type { DeckListPanelComponent } from "../types/svelte-components";
import type { IDatabaseService } from "../database/DatabaseFactory";
import type { DeckListSortMode } from "@/settings";

export class DecksView extends ItemView {
  private db: IDatabaseService;
  private deckSynchronizer: DeckSynchronizer;
  private deckManager: DeckManager;
  private scheduler: Scheduler;
  private statisticsService: StatisticsService;
  private tagGroupService: TagGroupService;
  private customDeckService: CustomDeckService;
  private settings: DecksSettings;
  private deckListPanelComponent: DeckListPanelComponent | null = null;
  private backgroundRefreshInterval: number | null = null;
  private progressTracker: ProgressTracker;
  private logger: Logger;
  private saveSettings: () => Promise<void>;
  private openEditModal?: (card: Flashcard) => Promise<void>;
  private openBatchRefactor?: (cards: Flashcard[]) => Promise<void>;
  private openAiGenerator?: () => void;
  private openAnkiImport?: () => void;

  constructor(
    leaf: WorkspaceLeaf,
    database: IDatabaseService,
    deckSynchronizer: DeckSynchronizer,
    deckManager: DeckManager,
    scheduler: Scheduler,
    statisticsService: StatisticsService,
    customDeckService: CustomDeckService,
    settings: DecksSettings,
    progressTracker: ProgressTracker,
    logger: Logger,
    saveSettings: () => Promise<void>,
    openEditModal?: (card: Flashcard) => Promise<void>,
    openBatchRefactor?: (cards: Flashcard[]) => Promise<void>,
    openAiGenerator?: () => void,
    openAnkiImport?: () => void,
  ) {
    super(leaf);
    this.db = database;
    this.deckSynchronizer = deckSynchronizer;
    this.deckManager = deckManager;
    this.scheduler = scheduler;
    this.statisticsService = statisticsService;
    this.tagGroupService = new TagGroupService(database);
    this.customDeckService = customDeckService;
    this.settings = settings;
    this.logger = logger;
    this.saveSettings = saveSettings;
    this.openEditModal = openEditModal;
    this.openBatchRefactor = openBatchRefactor;
    this.openAiGenerator = openAiGenerator;
    this.openAnkiImport = openAnkiImport;

    this.progressTracker = progressTracker;
  }

  private async togglePin(id: string): Promise<void> {
    const set = new Set(this.settings.ui.pinnedDeckIds);
    if (!set.delete(id)) set.add(id);
    this.settings.ui.pinnedDeckIds = [...set];
    await this.saveSettings();
    this.deckListPanelComponent?.updatePinnedIds?.(
      this.settings.ui.pinnedDeckIds,
    );
  }

  /**
   * Push fresh pinned ids into this view's panel from outside (the modal
   * calls this after a toggle so both views stay in sync without each
   * persisting independently).
   */
  applyPinnedIdsUpdate(ids: string[]): void {
    this.settings.ui.pinnedDeckIds = ids;
    this.deckListPanelComponent?.updatePinnedIds?.(ids);
  }

  private async setCollapsedIds(ids: string[]): Promise<void> {
    this.settings.ui.collapsedDeckNodeIds = ids;
    await this.saveSettings();
    this.deckListPanelComponent?.updateCollapsedIds?.(ids);
  }

  applyCollapsedIdsUpdate(ids: string[]): void {
    this.settings.ui.collapsedDeckNodeIds = ids;
    this.deckListPanelComponent?.updateCollapsedIds?.(ids);
  }

  private async changeSortMode(mode: DeckListSortMode): Promise<void> {
    this.settings.ui.deckListSort = mode;
    await this.saveSettings();
    this.deckListPanelComponent?.updateSortMode?.(mode);
  }

  applySortModeUpdate(mode: DeckListSortMode): void {
    this.settings.ui.deckListSort = mode;
    this.deckListPanelComponent?.updateSortMode?.(mode);
  }

  applyMinDeckCardCountUpdate(value: number): void {
    this.settings.ui.minDeckCardCount = value;
    this.deckListPanelComponent?.updateMinDeckCardCount?.(value);
  }

  applyAiEnabledUpdate(enabled: boolean): void {
    this.settings.ai.enabled = enabled;
    this.deckListPanelComponent?.updateAiEnabled?.(enabled);
  }

  getViewType(): string {
    return VIEW_TYPE_DECKS;
  }

  getDisplayText(): string {
    return I18n.t.views.decks;
  }

  getIcon(): string {
    return "brain";
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("decks-view");

    // Exam entry points on custom decks only make sense once any exam deck
    // exists; per-row gating for file decks and groups uses item.profile.
    let examCapable = false;
    try {
      examCapable = (await this.db.getExamEnabledDeckIds()).length > 0;
    } catch (error) {
      this.logger.debug("exam capability check failed", error);
    }

    // Create and mount Svelte component using Svelte 5 API
    this.deckListPanelComponent = mount(DeckListPanel, {
      target: container,
      props: {
        statisticsService: this.statisticsService,
        db: this.db,
        deckSynchronizer: this.deckSynchronizer,
        tagGroupService: this.tagGroupService,
        app: this.app,
        onDeckClick: (deck: DeckWithProfile) =>
          deck.profile.examEnabled
            ? this.startExamForSelection({ ...deck, type: "file" }, deck.profile)
            : this.startReview(deck),
        onDeckGroupClick: (deckGroup: DeckGroup) =>
          deckGroup.profile?.examEnabled
            ? this.startExamForSelection(deckGroup, deckGroup.profile)
            : this.startReviewForDeckGroup(deckGroup),
        onBrowseDeck: (deck: DeckWithProfile) => this.startBrowse(deck),
        onBrowseDeckGroup: (deckGroup: DeckGroup) => this.startBrowseForDeckGroup(deckGroup),
        onCramDeck: (deck: DeckWithProfile) => this.startCram(deck),
        onCramDeckGroup: (deckGroup: DeckGroup) => this.startCramForDeckGroup(deckGroup),
        isCramResumable: (deck: DeckWithProfile) =>
          this.scheduler.hasResumableCram({ ...deck, type: "file" }, new Date()),
        isCramResumableGroup: (deckGroup: DeckGroup) =>
          this.scheduler.hasResumableCram(deckGroup, new Date()),
        onCustomDeckClick: (customDeck: CustomDeckGroup) => this.startReviewForCustomDeck(customDeck),
        onBrowseCustomDeck: (customDeck: CustomDeckGroup) => this.startBrowseForCustomDeck(customDeck),
        onCramCustomDeck: (customDeck: CustomDeckGroup) => this.startCramForCustomDeck(customDeck),
        isCramResumableCustom: (customDeck: CustomDeckGroup) =>
          this.scheduler.hasResumableCram(customDeck, new Date()),
        onEditCustomDeck: (customDeck: CustomDeckGroup) => this.openEditCustomDeck(customDeck),
        onExamDeck: (deck: DeckWithProfile) =>
          this.startExamForSelection({ ...deck, type: "file" }, deck.profile),
        onExamDeckGroup: (deckGroup: DeckGroup) =>
          this.startExamForSelection(deckGroup, deckGroup.profile ?? null),
        onExamCustomDeck: (customDeck: CustomDeckGroup) =>
          this.startExamForSelection(customDeck, null),
        onReviewDeck: (deck: DeckWithProfile) => this.startReview(deck),
        onReviewDeckGroup: (deckGroup: DeckGroup) =>
          this.startReviewForDeckGroup(deckGroup),
        examCapable,
        customDeckService: this.customDeckService,
        onRefresh: () => this.refresh(),
        openStatisticsModal: () => this.openStatisticsModal(),
        openProfilesManagerModal: () => this.openProfilesManagerModal(),
        openSrMigrationModal: () => this.openSrMigrationModal(),
        openAnkiImportModal: () => this.openAnkiImport?.(),
        openDeckConfigModal: (deck: DeckWithProfile) => this.openDeckConfigModal(deck),
        openFlashcardManager: () => this.openFlashcardManager(),
        openAiGeneratorModal: () => this.openAiGenerator?.(),
        aiEnabled: this.settings.ai.enabled,
        deckTag: this.settings.parsing.deckTag,
        pinnedDeckIds: this.settings.ui.pinnedDeckIds,
        onTogglePin: (id: string) => this.togglePin(id),
        deckListSort: this.settings.ui.deckListSort,
        minDeckCardCount: this.settings.ui.minDeckCardCount,
        onChangeSortMode: (mode: DeckListSortMode) => this.changeSortMode(mode),
        collapsedDeckNodeIds: this.settings.ui.collapsedDeckNodeIds,
        onSetCollapsedIds: (ids: string[]) => this.setCollapsedIds(ids),
        globalReviewToday: null,
      },
    }) as DeckListPanelComponent;

    // Initial refresh
    await this.refresh();

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

    // Clean up background refresh
    this.stopBackgroundRefresh();
  }

  async update(updatedDecks: DeckWithProfile[], deckStats: Map<string, DeckStats>) {
    await this.deckListPanelComponent?.updateAll?.(updatedDecks, deckStats);
    await this.pushGlobalReviewCap();
  }

  // Refresh the deck list's global daily review-cap indicator.
  private async pushGlobalReviewCap(): Promise<void> {
    try {
      const status = await this.deckManager.getGlobalDailyCapStatus();
      this.deckListPanelComponent?.updateGlobalReviewToday?.(status);
    } catch (error) {
      this.logger.debug("Could not refresh global review cap status", error);
    }
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
    void this.db.getActiveTrainedWeightSet().then((active) => {
      new ProfilesManagerModal(
        this.app,
        this.db,
        async () => {
          await this.refresh();
        },
        active !== null
      ).open();
    });
  }

  openSrMigrationModal(): void {
    const controller = new SrMigrationController(
      this.app,
      this.db,
      this.deckSynchronizer,
      this.settings,
      this.logger
    );
    new SrMigrationModalWrapper(
      this.app,
      this.db,
      controller,
      async () => {
        await this.refresh();
      }
    ).open();
  }

  openFlashcardManager(): void {
    openFlashcardManager(
      this.app,
      this.db,
      this.customDeckService,
      this.settings,
      undefined,
      () => this.refresh(),
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
  }


  openEditCustomDeck(customDeck: CustomDeckGroup): void {
    if (customDeck.deckType === "filter") {
      const filterDefinition: FilterDefinition = customDeck.filterDefinition
        ? JSON.parse(customDeck.filterDefinition)
        : { version: 1, logic: "AND", rules: [] };
      openFlashcardManager(
        this.app,
        this.db,
        this.customDeckService,
        this.settings,
        { kind: "filter", id: customDeck.id, name: customDeck.name, filterDefinition },
        () => this.refresh(),
        async () => {
          await this.deckManager.cleanupOrphanedDecks();
        },
      );
    } else {
      openFlashcardManager(
        this.app,
        this.db,
        this.customDeckService,
        this.settings,
        { kind: "manual", id: customDeck.id, name: customDeck.name },
        () => this.refresh(),
        async () => {
          await this.deckManager.cleanupOrphanedDecks();
        },
      );
    }
  }

  openDeckConfigModal(deck: DeckWithProfile): void {
    new DeckConfigModal(
      this.app,
      deck,
      this.db,
      async () => {
        await this.refresh();
      }
    ).open();
  }

  /**
   * Stale-while-revalidate refresh. Two stages:
   *   1. Instant paint from the DB (no sync) so the user sees their decks
   *      within a single DB-query round-trip rather than waiting for the
   *      full sync (vault scan + per-deck reparse + stats).
   *   2. Background sync that re-paints only if something changed.
   *
   * Pass `skipSync: true` to suppress stage 2 — used when reopening the
   * modal right after a review, where the deck list cannot have meaningfully
   * changed since the last sync.
   */
  async refresh(options: { skipSync?: boolean } = {}): Promise<void> {
    this.logger.debug("DecksView.refresh() called", options);
    try {
      // Stage 1: paint from current DB state.
      const initialDecks = await this.db.getAllDecksWithProfiles();
      const initialStats = await this.getAllDeckStatsMap();
      await this.update(initialDecks, initialStats);
    } catch (error) {
      this.logger.error("Error painting initial deck state:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice(I18n.t.notices.errorLoadingDecks);
      }
      return;
    }

    if (options.skipSync) return;
    // Skip sync if one completed within the last 2s — the data is fresh
    // enough and we'd just be re-triggering a no-op vault scan.
    const sinceLastSync = Date.now() - this.deckSynchronizer.lastSyncCompletedAt;
    if (sinceLastSync >= 0 && sinceLastSync < 2000) {
      this.logger.debug(`DecksView.refresh skipping sync (${sinceLastSync}ms since last)`);
      return;
    }

    // Stage 2: background sync. On the first refresh after load, wait for the
    // workspace to be ready (metadata cache warm) so the sync scans against a
    // populated cache rather than a fixed delay. onLayoutReady runs the callback
    // immediately if the layout is already ready (view opened later).
    if (this.firstRefreshPending) {
      this.firstRefreshPending = false;
      this.app.workspace.onLayoutReady(() => void this.runBackgroundSync());
    } else {
      void this.runBackgroundSync();
    }
  }

  // Single-flight guard so rapid refresh triggers (modal open + focus
  // event in the same frame, say) don't fan out into concurrent syncs.
  private backgroundSyncInFlight = false;
  // The first refresh happens during Obsidian startup (restored-open panel);
  // defer its background sync so it doesn't compete with startup work.
  private firstRefreshPending = true;

  private async runBackgroundSync(): Promise<void> {
    if (this.backgroundSyncInFlight) return;
    this.backgroundSyncInFlight = true;
    try {
      this.deckListPanelComponent?.setSyncing?.(true);
      await this.deckSynchronizer.performSync();
      const decks = await this.db.getAllDecksWithProfiles();
      const stats = await this.getAllDeckStatsMap();
      await this.update(decks, stats);
      this.logger.debug("Background sync complete");
    } catch (error) {
      this.logger.error("Background sync failed:", error);
    } finally {
      this.deckListPanelComponent?.setSyncing?.(false);
      this.backgroundSyncInFlight = false;
    }
  }

  async refreshDecksAndStats() {
    this.logger.debug("DecksView.refreshDecksAndStats() called");
    try {
      const updatedDecks = await this.db.getAllDecksWithProfiles();
      const deckStats = await this.getAllDeckStatsMap();
      await this.update(updatedDecks, deckStats);
    } catch (error) {
      console.error("Error refreshing decks and stats:", error);
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
        await this.pushGlobalReviewCap();
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
      const customDeck = await this.db.getCustomDeckById(deckId);
      if (customDeck) {
        const stats = await this.customDeckService.getCustomDeckStats(deckId);
        this.deckListPanelComponent?.updateCustomDeckStatsById?.(deckId, stats);
        return;
      }

      const deckStats = await this.deckManager.getDeckStats(deckId);
      this.logger.debug("Updated deck stats for:", deckId);

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

    this.backgroundRefreshInterval = this.registerInterval(
      window.setInterval(() => {
        if (this.deckSynchronizer.isReviewing) return; // don't sync during review

        this.logger.debug("Background refresh tick");
        void this.refresh();
      }, this.settings.ui.backgroundRefreshInterval * 1000)
    );
  }

  stopBackgroundRefresh() {
    if (this.backgroundRefreshInterval) {
      this.logger.debug("Stopping background refresh job");
      window.clearInterval(this.backgroundRefreshInterval);
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

  private openReviewSession(
    deckOrGroup: DeckOrGroup,
    cards: Flashcard[],
    browseMode: boolean
  ): void {
    if (this.settings.ui.reviewDisplayMode === "tab") {
      this.openReviewInTab(deckOrGroup, cards, browseMode);
    } else {
      new FlashcardReviewModalWrapper(
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
      ).open();
    }
  }

  // Cram always opens the focused modal (no tab-mode variant) — it's a
  // short drill isolated from real scheduling.
  private openCramSession(deckOrGroup: DeckOrGroup, cards: Flashcard[]): void {
    new FlashcardReviewModalWrapper(
      this.app,
      deckOrGroup,
      cards,
      this.scheduler,
      this.settings,
      this.db,
      this.deckSynchronizer,
      this.refreshDecksAndStats.bind(this),
      this.refreshStatsById.bind(this),
      false, // browseMode
      true // cramMode
    ).open();
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

  // Sync only the decks whose file changed (one bulk meta query + mtime checks).
  private async syncStaleDecks(deckIds: string[]): Promise<void> {
    const stale = await this.deckManager.getStaleDeckIds();
    for (const id of deckIds) {
      if (stale.has(id)) {
        await this.deckSynchronizer.syncDeck(id, { force: true });
        await yieldToUI();
      }
    }
  }

  async startReview(deck: DeckWithProfile) {
    try {
      await this.syncStaleDecks([deck.id]);
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
        let message = I18n.format(I18n.t.notices.noCardsDueForReview, {
          deckName: deck.name,
        });

        // Check if limits are the reason no cards are available
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

      // Show daily limit info before starting review if limits are active
      if (profile.hasNewCardsLimitEnabled || profile.hasReviewCardsLimitEnabled) {
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

  async startReviewForDeckGroup(deckGroup: DeckGroup) {
    try {
      this.logger.debug(`Starting review for deck group: ${deckGroup.name}`);

      // Sync only the decks in the group whose files changed (else instant).
      await this.syncStaleDecks(deckGroup.deckIds);

      // Check for available cards
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

  async startBrowse(deck: DeckWithProfile) {
    try {
      this.logger.debug(`Starting browse mode for deck: ${deck.name}`);
      await this.syncStaleDecks([deck.id]);

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

  async startBrowseForDeckGroup(deckGroup: DeckGroup) {
    try {
      this.logger.debug(`Starting browse mode for deck group: ${deckGroup.name}`);

      await this.syncStaleDecks(deckGroup.deckIds);

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

  async startReviewForCustomDeck(customDeck: CustomDeckGroup) {
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

  async startBrowseForCustomDeck(customDeck: CustomDeckGroup) {
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

  async startCram(deck: DeckWithProfile) {
    try {
      this.logger.debug(`Starting cram for deck: ${deck.name}`);
      await this.syncStaleDecks([deck.id]);

      const allCards = await this.db.getFlashcardsByDeck(deck.id);
      if (allCards.length === 0) {
        if (this.settings?.ui?.enableNotices !== false) {
          new Notice(
            I18n.format(I18n.t.notices.noCardsFoundInDeck, { deckName: deck.name })
          );
        }
        return;
      }

      this.openCramSession({ ...deck, type: "file" }, allCards);
    } catch (error) {
      console.error("Error starting cram:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice(I18n.t.notices.errorStartingCram);
      }
    }
  }

  async startCramForDeckGroup(deckGroup: DeckGroup) {
    try {
      this.logger.debug(`Starting cram for deck group: ${deckGroup.name}`);
      await this.syncStaleDecks(deckGroup.deckIds);

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

      this.openCramSession(deckGroup, allCards);
    } catch (error) {
      console.error("Error starting deck group cram:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice(I18n.t.notices.errorStartingCram);
      }
    }
  }

  async startCramForCustomDeck(customDeck: CustomDeckGroup) {
    try {
      this.logger.debug(`Starting cram for custom deck: ${customDeck.name}`);

      const allCards = await this.db.getFlashcardsForCustomDeck(customDeck.id);
      if (allCards.length === 0) {
        if (this.settings?.ui?.enableNotices !== false) {
          new Notice(
            I18n.format(I18n.t.notices.noCardsFoundInGroup, { name: customDeck.name })
          );
        }
        return;
      }

      this.openCramSession(customDeck, allCards);
    } catch (error) {
      console.error("Error starting custom deck cram:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice(I18n.t.notices.errorStartingCram);
      }
    }
  }

  private async gatherSelectionCards(selection: DeckOrGroup): Promise<Flashcard[]> {
    if (selection.type === "file") {
      await this.syncStaleDecks([selection.id]);
      return this.db.getFlashcardsByDeck(selection.id);
    }
    if (selection.type === "custom") {
      return this.db.getFlashcardsForCustomDeck(selection.id);
    }
    await this.syncStaleDecks(selection.deckIds);
    const allCards: Flashcard[] = [];
    for (const deckId of selection.deckIds) {
      allCards.push(...(await this.db.getFlashcardsByDeck(deckId)));
    }
    return allCards;
  }

  async startExamForSelection(
    selection: DeckOrGroup,
    profile: DeckProfile | null
  ): Promise<void> {
    await launchExamForSelection(
      { app: this.app, db: this.db, settings: this.settings },
      selection,
      profile,
      (s) => this.gatherSelectionCards(s),
      (attempt, deckName, onRetake) =>
        this.openExamSession(attempt, deckName, onRetake)
    );
  }

  private openExamSession(
    attempt: ExamAttempt,
    deckName: string,
    onRetake: () => void
  ): void {
    if (this.settings.ui.reviewDisplayMode === "tab") {
      this.openExamInTab(attempt, deckName, onRetake);
    } else {
      new ExamModalWrapper(
        this.app,
        attempt,
        deckName,
        this.db,
        onRetake,
        this.refreshDecksAndStats.bind(this)
      ).open();
    }
  }

  private openExamInTab(
    attempt: ExamAttempt,
    deckName: string,
    onRetake: () => void
  ): void {
    const { workspace } = this.app;
    const existingLeaves = workspace.getLeavesOfType(VIEW_TYPE_FLASHCARD_EXAM);
    const leaf: WorkspaceLeaf =
      existingLeaves.length > 0 ? existingLeaves[0] : workspace.getLeaf("tab");

    void leaf
      .setViewState({ type: VIEW_TYPE_FLASHCARD_EXAM, active: true })
      .then(() => {
        const view = leaf.view;
        if (view instanceof ExamView) {
          view.setExamData(
            attempt,
            deckName,
            onRetake,
            this.refreshDecksAndStats.bind(this)
          );
        }
        void workspace.revealLeaf(leaf);
      })
      .catch(console.error);
  }
}
