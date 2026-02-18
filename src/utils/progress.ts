import { Notice } from "obsidian";
import type { DecksSettings } from "../settings";

export class ProgressTracker {
  private progressNotice: Notice | null = null;
  private settings: DecksSettings;
  private lastUpdateTime = 0;
  private pendingMessage: string | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly THROTTLE_MS = 150;

  constructor(settings: DecksSettings) {
    this.settings = settings;
  }

  show(message: string): void {
    if (!this.progressNotice && this.settings?.ui?.enableNotices !== false) {
      this.progressNotice = new Notice(message, 0);
    }
  }

  update(message: string, progress = 0): void {
    if (!this.progressNotice) return;

    const formatted = `${message}\n${this.createProgressBar(progress)}`;
    const now = Date.now();

    if (progress >= 100 || now - this.lastUpdateTime >= ProgressTracker.THROTTLE_MS) {
      this.flushPending();
      this.progressNotice.setMessage(formatted);
      this.lastUpdateTime = now;
    } else {
      this.pendingMessage = formatted;
      if (!this.pendingTimer) {
        const remaining = ProgressTracker.THROTTLE_MS - (now - this.lastUpdateTime);
        this.pendingTimer = setTimeout(() => this.flushPending(), remaining);
      }
    }
  }

  hide(): void {
    this.flushPending();
    if (this.progressNotice) {
      this.progressNotice.hide();
      this.progressNotice = null;
    }
  }

  isVisible = (): boolean => this.progressNotice != null;

  private flushPending(): void {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    if (this.pendingMessage && this.progressNotice) {
      this.progressNotice.setMessage(this.pendingMessage);
      this.lastUpdateTime = Date.now();
      this.pendingMessage = null;
    }
  }

  private createProgressBar(progress: number): string {
    const width = 25;
    const filled = Math.round((progress / 100) * width);
    const empty = width - filled;
    const bar = "█".repeat(filled) + "░".repeat(empty);
    const percentage = Math.round(progress);
    return `[${bar}] ${percentage}%`;
  }
}
