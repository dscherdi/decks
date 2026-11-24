import type { DecksSettings } from "../settings";
import type { DataAdapter } from "obsidian";

/** Past this size the log moves aside to `debug.old.log`, so writing a line never handles a large file. */
export const MAX_LOG_BYTES = 1_000_000;

type LogAdapter = Pick<DataAdapter, "stat" | "write" | "append" | "exists" | "remove" | "rename">;

export class Logger {
  private pending: string[] = [];
  private writing: Promise<void> | null = null;

  constructor(
    private settings: DecksSettings,
    private adapter?: LogAdapter,
    private configDir?: string,
    private manifestDir?: string
  ) {}

  // Arrow properties, so a method handed out detached or bound to another object still logs here.
  debug = (message: string, ...args: unknown[]): void => {
    if (this.settings?.debug?.enableLogging) {
      console.debug(`[Decks Debug] ${message}`, ...args);
      this.enqueue(message, args);
    }
  };

  error = (message: string, ...args: unknown[]): void => {
    if (this.settings?.debug?.enableLogging) {
      console.error(`[Decks Error] ${message}`, ...args);
      this.enqueue(message, args);
    }
  };

  performance(message: string, ...args: unknown[]): void {
    if (this.settings?.debug?.performanceLogs) {
      console.debug(`[Decks Performance] ${message}`, ...args);
    }
  }

  /** Resolves once every line logged so far is in the file. */
  async flush(): Promise<void> {
    while (this.writing) await this.writing;
  }

  private logPath(): string | null {
    if (!this.adapter || !this.configDir || !this.manifestDir) return null;
    return `${this.configDir}/plugins/${this.manifestDir}/debug.log`;
  }

  private enqueue(message: string, args: unknown[]): void {
    if (!this.logPath()) return;
    const argsText = args.length > 0 ? ` ${args.map(formatLogArg).join(" ")}` : "";
    this.pending.push(`[${new Date().toISOString()}] ${message}${argsText}\n`);
    this.startWriting();
  }

  // One writer at a time; lines logged while it runs go out together in its next append.
  private startWriting(): void {
    if (this.writing) return;
    this.writing = this.writePending().finally(() => {
      this.writing = null;
      if (this.pending.length > 0) this.startWriting();
    });
  }

  private async writePending(): Promise<void> {
    const path = this.logPath();
    const adapter = this.adapter;
    if (!path || !adapter) return;
    while (this.pending.length > 0) {
      const text = this.pending.join("");
      this.pending = [];
      try {
        const stat = await adapter.stat(path);
        if (stat && stat.size >= MAX_LOG_BYTES) {
          const old = path.replace(/\.log$/, ".old.log");
          if (await adapter.exists(old)) await adapter.remove(old);
          await adapter.rename(path, old);
          await adapter.write(path, text);
        } else if (stat) {
          await adapter.append(path, text);
        } else {
          await adapter.write(path, text);
        }
      } catch (error) {
        console.error("[Decks Debug] Failed to write to log file:", error);
      }
    }
  }
}

/** An Error by its name and message; JSON alone would write it as `{}`. */
export function formatLogArg(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (typeof arg === "string" || typeof arg === "number" || typeof arg === "boolean") {
    return String(arg);
  }
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return String(arg);
  }
}

export function formatTime(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(2)}ms`;
  } else {
    return `${(ms / 1000).toFixed(2)}s`;
  }
}
