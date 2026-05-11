export interface DecksSettings {
  // Review Session Settings
  review: {
    showProgress: boolean;
    enableKeyboardShortcuts: boolean;
    sessionDuration: number; // Session duration in minutes (1-60, default 25)
    nextDayStartsAt: number; // Hour (0-23) when study day rolls over (default 4 AM)
    leechThreshold: number; // Lapses count at/above which a card is flagged as a leech (default 8)
    denseCardCharThreshold: number; // back text length (chars) at/above which a card is flagged as dense (default 500)
  };

  // Parsing Settings
  parsing: {
    folderSearchPath: string; // Folder path to scan for flashcard files, empty means scan entire vault
    deckTag: string; // Base tag used to identify flashcard decks (e.g., "#decks", "#flashcards")
  };

  // UI Settings
  ui: {
    enableBackgroundRefresh: boolean;
    backgroundRefreshInterval: number; // seconds
    enableNotices: boolean;
    reviewDisplayMode: "modal" | "tab";
  };

  // Backup Settings
  backup: {
    enableAutoBackup: boolean;
    maxBackups: number;
  };

  // Debug Settings
  debug: {
    enableLogging: boolean;
    performanceLogs: boolean;
  };

  // Global FSRS weight optimization. Whether a STANDARD profile applies these
  // trained weights is a per-profile choice (DeckProfile.fsrs.useTrainedWeights);
  // INTENSIVE profiles always ignore them.
  fsrs: {
    trainedWeights: number[] | null; // null = no trained weights yet
    lastTrainedAt: string | null;
    lastTrainedReviewCount: number;
    lastBeforeLogLoss: number | null;
    lastAfterLogLoss: number | null;
  };

  // Internal tracking
  hasCreatedTestDeck: boolean;
}

export const DEFAULT_SETTINGS: DecksSettings = {
  review: {
    showProgress: true,
    enableKeyboardShortcuts: true,
    sessionDuration: 25,
    nextDayStartsAt: 4,
    leechThreshold: 8,
    denseCardCharThreshold: 500,
  },

  parsing: {
    folderSearchPath: "", // Default: scan entire vault
    deckTag: "#decks",
  },

  ui: {
    enableBackgroundRefresh: true,
    backgroundRefreshInterval: 120,
    enableNotices: true,
    reviewDisplayMode: "modal",
  },

  backup: {
    enableAutoBackup: true,
    maxBackups: 5,
  },

  debug: {
    enableLogging: false,
    performanceLogs: false,
  },

  fsrs: {
    trainedWeights: null,
    lastTrainedAt: null,
    lastTrainedReviewCount: 0,
    lastBeforeLogLoss: null,
    lastAfterLogLoss: null,
  },

  hasCreatedTestDeck: false,
};
