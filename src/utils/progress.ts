import { Notice } from "obsidian";
import { DecksSettings } from "../settings";

export class ProgressTracker {
    private progressNotice: Notice | null = null;
    private settings: DecksSettings;

    constructor(settings: DecksSettings) {
        this.settings = settings;
    }

    show(message: string): void {
        if (
            !this.progressNotice &&
            this.settings?.ui?.enableNotices !== false
        ) {
            this.progressNotice = new Notice(message, 0);
        }
    }

    update(message: string, progress = 0): void {
        if (this.progressNotice) {
            const progressBar = this.createProgressBar(progress);
            this.progressNotice.setMessage(`${message}\n${progressBar}`);
        }
    }

    hide(): void {
        if (this.progressNotice) {
            this.progressNotice.hide();
            this.progressNotice = null;
        }
    }

    isVisible = (): boolean => this.progressNotice != null;

    private createProgressBar(progress: number): string {
        const width = 25;
        const filled = Math.round((progress / 100) * width);
        const empty = width - filled;
        const bar = "█".repeat(filled) + "░".repeat(empty);
        const percentage = Math.round(progress);
        return `[${bar}] ${percentage}%`;
    }
}
