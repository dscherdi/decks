import type {
  DeckWithProfile,
  DeckStats,
  DeckGroup,
  Flashcard,
  DeckOrGroup,
  CustomDeckGroup,
} from "@/database/types";
import { DeckSynchronizer } from "@/services/DeckSynchronizer";
import { DeckManager } from "@/services/DeckManager";
import type { DecksSettings } from "@/settings";
import { yieldToUI } from "@/utils/ui";
import { Logger } from "@/utils/logging";
import { Modal, Notice, WorkspaceLeaf } from "obsidian";
import type { App } from "obsidian";
import { Scheduler } from "@/services/Scheduler";
import { FlashcardReviewModalWrapper } from "./review/FlashcardReviewModalWrapper";
import {
  FlashcardReviewView,
  VIEW_TYPE_FLASHCARD_REVIEW,
} from "./review/FlashcardReviewView";
import { StatisticsModal } from "./settings/StatisticsModal";
import { ProfilesManagerModal } from "./config/ProfilesManagerModal";
import { DeckConfigModal } from "./config/DeckConfigModal";
import { StatisticsService } from "@/services/StatisticsService";
import { TagGroupService } from "@/services/TagGroupService";
import { CustomDeckService } from "@/services/CustomDeckService";
import { FlashcardManagerModal } from "./FlashcardManagerModal";
import { EditFilterModal } from "./EditFilterModal";
import { CreateCustomDeckModal } from "./CreateCustomDeckModal";

import DeckListPanel from "./DeckListPanel.svelte";
import { mount, unmount } from "svelte";
import type { DeckListPanelComponent } from "../types/svelte-components";
import type { IDatabaseService } from "../database/DatabaseFactory";
import type { DecksView } from "./DecksView";

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
    getDecksView: () => DecksView | null
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
        onCreateCustomDeck: () => this.openCreateCustomDeck(),
        onRefresh: () => this.refresh(),
        openStatisticsModal: () => this.openStatisticsModal(),
        openProfilesManagerModal: () => this.openProfilesManagerModal(),
        openDeckConfigModal: (deck: DeckWithProfile) =>
          this.openDeckConfigModal(deck),
        openFlashcardManager: () => this.openFlashcardManager(),
        deckTag: this.settings.parsing.deckTag,
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

  private reopenSelf() {
    new DecksViewModal(
      this.app,
      this.db,
      this.deckSynchronizer,
      this.deckManager,
      this.scheduler,
      this.statisticsService,
      this.customDeckService,
      this.settings,
      this.logger,
      this.getDecksView
    ).open();
  }

  private openWithReturn(childModal: Modal) {
    this.close();
    const originalOnClose = childModal.onClose.bind(childModal);
    childModal.onClose = () => {
      originalOnClose();
      const isSourceNav =
        childModal instanceof FlashcardReviewModalWrapper &&
        childModal.navigatedToSource;
      if (!isSourceNav) {
        this.reopenSelf();
      }
    };
    childModal.open();
  }

  private async refresh() {
    try {
      await this.deckSynchronizer.performSync();
      const updatedDecks = await this.db.getAllDecksWithProfiles();
      const deckStats = await this.getAllDeckStatsMap();
      await this.deckListPanelComponent?.updateAll?.(updatedDecks, deckStats);
    } catch (error) {
      this.logger.error("Error refreshing decks in modal:", error);
    }
  }

  private async getAllDeckStatsMap(): Promise<Map<string, DeckStats>> {
    return await this.deckManager.getAllDeckStatsMap();
  }

  private async refreshDecksAndStats() {
    const view = this.getDecksView();
    if (view) {
      await view.refreshDecksAndStats();
    }
  }

  private async refreshStatsById(deckId: string) {
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
    const modal = new ProfilesManagerModal(this.app, this.db, async () => {
      const view = this.getDecksView();
      if (view) await view.refresh();
    });
    this.openWithReturn(modal);
  }

  private openDeckConfigModal(deck: DeckWithProfile): void {
    const modal = new DeckConfigModal(this.app, deck, this.db, async () => {
      const view = this.getDecksView();
      if (view) await view.refresh();
    });
    this.openWithReturn(modal);
  }

  private openFlashcardManager(): void {
    const modal = new FlashcardManagerModal(
      this.app,
      this.db,
      this.customDeckService,
    );
    this.openWithReturn(modal);
  }

  private openCreateCustomDeck(): void {
    this.customDeckService.getAllCustomDecks()
      .then((decks) => {
        const modal = new CreateCustomDeckModal(
          this.app,
          decks.map(d => d.name),
          this.customDeckService,
          this.db,
          () => void this.refresh(),
        );
        this.openWithReturn(modal);
      })
      .catch(console.error);
  }

  private openEditCustomDeck(customDeck: CustomDeckGroup): void {
    if (customDeck.deckType === "filter") {
      const modal = new EditFilterModal(
        this.app,
        customDeck,
        this.customDeckService,
        this.db,
        () => void this.refresh(),
      );
      this.openWithReturn(modal);
    } else {
      const modal = new FlashcardManagerModal(
        this.app,
        this.db,
        this.customDeckService,
        { id: customDeck.id, name: customDeck.name },
      );
      this.openWithReturn(modal);
    }
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
            this.refreshStatsById.bind(this)
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
        let message = `No cards due for review in ${deck.name}`;

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

      if (
        profile.hasNewCardsLimitEnabled ||
        profile.hasReviewCardsLimitEnabled
      ) {
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

      this.openReviewSession({ ...deck, type: "file" }, [nextCard], false);
    } catch (error) {
      console.error("Error starting review:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice("Error starting review. Check console for details.");
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
            `No cards due in "${deckGroup.name}" (${deckGroup.deckIds.length} files)`
          );
        }
        return;
      }

      this.openReviewSession(deckGroup, [nextCard], false);
    } catch (error) {
      console.error("Error starting deck group review:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice("Error starting review. Check console for details.");
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
          new Notice(`No cards found in ${deck.name}`);
        }
        return;
      }

      this.openReviewSession({ ...deck, type: "file" }, allCards, true);
    } catch (error) {
      console.error("Error starting browse:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice("Error starting browse. Check console for details.");
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
          new Notice(`No cards found in "${deckGroup.name}"`);
        }
        return;
      }

      this.openReviewSession(deckGroup, allCards, true);
    } catch (error) {
      console.error("Error starting deck group browse:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice("Error starting browse. Check console for details.");
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
          new Notice(`No cards due in "${customDeck.name}" (${customDeck.flashcardIds.length} cards)`);
        }
        return;
      }

      this.openReviewSession(customDeck, [nextCard], false);
    } catch (error) {
      console.error("Error starting custom deck review:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice("Error starting review. Check console for details.");
      }
    }
  }

  private async startBrowseForCustomDeck(customDeck: CustomDeckGroup) {
    try {
      this.logger.debug(`Starting browse mode for custom deck: ${customDeck.name}`);

      const allCards = await this.db.getFlashcardsForCustomDeck(customDeck.id);

      if (allCards.length === 0) {
        if (this.settings?.ui?.enableNotices !== false) {
          new Notice(`No cards found in "${customDeck.name}"`);
        }
        return;
      }

      this.openReviewSession(customDeck, allCards, true);
    } catch (error) {
      console.error("Error starting custom deck browse:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice("Error starting browse. Check console for details.");
      }
    }
  }
}
