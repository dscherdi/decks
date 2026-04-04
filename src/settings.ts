export interface DecksSettings {
  // Review Session Settings
  review: {
    showProgress: boolean;
    enableKeyboardShortcuts: boolean;
    sessionDuration: number; // Session duration in minutes (1-60, default 25)
    nextDayStartsAt: number; // Hour (0-23) when study day rolls over (default 4 AM)
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

  // Experimental Settings
  experimental: {
    enableDatabaseWorker: boolean;
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
  },

  parsing: {
    folderSearchPath: "", // Default: scan entire vault
    deckTag: "#decks",
  },

  ui: {
    enableBackgroundRefresh: true,
    backgroundRefreshInterval: 120,
    enableNotices: true,
  },

  backup: {
    enableAutoBackup: true,
    maxBackups: 5,
  },

  debug: {
    enableLogging: false,
    performanceLogs: false,
  },

  experimental: {
    enableDatabaseWorker: false,
  },

  hasCreatedTestDeck: false,
};
