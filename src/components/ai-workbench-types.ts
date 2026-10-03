import type { AiModelOption, AiSession, AiStagedCard, SessionCounts } from "@decks/core";

/** Everything the hub needs, loaded by the plugin and handed over whole. */
export interface AiWorkbenchData {
  sessions: AiSession[];
  counts: Record<string, SessionCounts>;
  flagged: AiStagedCard[];
  outcome: { saved: number; discarded: number };
  /** The session the generator leaf shows, if any. */
  activeSessionId: string | null;
  gap: AiWorkbenchGap | null;
  /** The model picker, when the provider offers more than one. */
  model: { options: AiModelOption[]; selected: string } | null;
}

/** Concepts the most recent session's source has no card for. */
export interface AiWorkbenchGap {
  sessionId: string;
  source: string;
  concepts: Array<{ term: string; page: number }>;
}

/** Keep over the flag, discard, or open the session on the card to fix it. */
export type TriageAction = "keep" | "discard" | "fix";
