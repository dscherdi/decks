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
    customPath?: string;
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
}

export const DEFAULT_SETTINGS: FlashcardsSettings = {
  fsrs: {
    requestRetention: 0.9,
    maximumInterval: 36500, // 100 years
    easyBonus: 1.3,
    hardInterval: 1.2,
    weights: [
      0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05,
      0.34, 1.26, 0.29, 2.61,
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
};
