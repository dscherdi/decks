import type { DecksSettings } from "../settings";
import type { DataAdapter } from "obsidian";

export class Logger {
  constructor(
    private settings: DecksSettings,
    private adapter?: DataAdapter,
    private configDir?: string
  ) {}

  debug(message: string, ...args: unknown[]): void {
    if (this.settings?.debug?.enableLogging) {
      console.debug(`[Decks Debug] ${message}`, ...args);
      if (this.adapter && this.configDir) {
        void this.writeToLogFile(message, ...args);
      }
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.settings?.debug?.enableLogging) {
      console.error(`[Decks Error] ${message}`, ...args);
      if (this.adapter && this.configDir) {
        void this.writeToLogFile(message, ...args);
      }
    }
  }

  performance(message: string, ...args: unknown[]): void {
    if (this.settings?.debug?.performanceLogs) {
      console.debug(`[Decks Performance] ${message}`, ...args);
    }
  }

  private async writeToLogFile(
    message: string,
    ...args: unknown[]
  ): Promise<void> {
    try {
      if (!this.adapter || !this.configDir) return;

      const logPath = `${this.configDir}/plugins/decks/debug.log`;

      const timestamp = new Date().toISOString();
      const argsStr =
        args.length > 0
          ? ` ${args
              .map((arg) =>
                typeof arg === "object" ? JSON.stringify(arg) : String(arg)
              )
              .join(" ")}`
          : "";
      const logEntry = `[${timestamp}] ${message}${argsStr}\n`;

      let existingContent = "";
      if (await this.adapter.exists(logPath)) {
        existingContent = await this.adapter.read(logPath);
      }

      await this.adapter.write(logPath, existingContent + logEntry);
    } catch (error) {
      console.error("[Decks Debug] Failed to write to log file:", error);
    }
  }
}

export function formatTime(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(2)}ms`;
  } else {
    return `${(ms / 1000).toFixed(2)}s`;
  }
}
