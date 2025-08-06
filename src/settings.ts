export interface FlashcardsSettings {
  // FSRS Algorithm Settings
  fsrs: {
    requestRetention: number;
    maximumInterval: number;
    easyBonus: number;
    hardInterval: number;
    weights: number[];
  };

  // Database Settings
  database: {
    autoBackup: boolean;
    backupInterval: number; // days
  };

  // Review Session Settings
  review: {
    showProgress: boolean;
    enableKeyboardShortcuts: boolean;
    sessionGoal: number; // cards per session
    enableSessionLimit: boolean;
  };

  // Parsing Settings
  parsing: {
    headerLevel: number; // 1-6, which header level to parse for header-paragraph flashcards
  };

  // UI Settings
  ui: {
    enableBackgroundRefresh: boolean;
    backgroundRefreshInterval: number; // seconds
  };

  // Debug Settings
  debug: {
    enableLogging: boolean;
  };
}

export const DEFAULT_SETTINGS: FlashcardsSettings = {
  fsrs: {
    requestRetention: 0.9,
    maximumInterval: 36500, // 100 years
    easyBonus: 1.3,
    hardInterval: 1.2,
    weights: [
      0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0234, 1.616,
      0.1544, 1.0824, 1.9813, 0.0953, 0.2975, 2.2042, 0.2407, 2.9466,
    ],
  },

  database: {
    autoBackup: true,
    backupInterval: 7,
  },

  review: {
    showProgress: true,
    enableKeyboardShortcuts: true,
    sessionGoal: 20,
    enableSessionLimit: false,
  },

  parsing: {
    headerLevel: 2, // Default to H2 headers
  },

  ui: {
    enableBackgroundRefresh: true,
    backgroundRefreshInterval: 5,
  },

  debug: {
    enableLogging: false,
  },
};
