export type DeckListSortMode =
  | "name-asc"
  | "name-desc"
  | "new-asc"
  | "new-desc"
  | "due-asc"
  | "due-desc";

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
    // Deck / group / custom-deck ids the user has pinned to the top of
    // the deck list. Synced across devices via data.json.
    pinnedDeckIds: string[];
    // Active sort key + direction for the deck list column headers.
    deckListSort: DeckListSortMode;
    // Decks with totalCount strictly less than this number are hidden
    // from the list. Pinned decks are exempt. 0 disables the filter.
    minDeckCardCount: number;
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

  // File location settings. All paths are vault-relative — empty/unset uses
  // the per-field default so existing installs are unaffected. The intended
  // use case is moving these files out of the hidden .obsidian/ folder so
  // iCloud syncs them at first-class priority instead of the deprioritized
  // hidden-directory tier.
  paths: {
    // Folder holding the SQLite DB. Default: plugin folder (".obsidian/plugins/decks").
    // Changes require a restart to take effect.
    dbFolder: string;
    // Folder for periodic backups. Default: plugin folder + "/backups".
    // Read on demand by BackupService, so changes take effect immediately
    // without restart.
    backupFolder: string;
    // Folder for the per-device .deckssynclog files. Default: vault root.
    // Changes require a restart to take effect.
    syncLogFolder: string;
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
    enableNotices: false,
    reviewDisplayMode: "modal",
    pinnedDeckIds: [],
    deckListSort: "name-asc",
    minDeckCardCount: 0,
  },

  backup: {
    enableAutoBackup: true,
    maxBackups: 5,
  },

  debug: {
    enableLogging: false,
    performanceLogs: false,
  },

  paths: {
    dbFolder: "",
    backupFolder: "",
    syncLogFolder: "",
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
