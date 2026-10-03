import type { AiGradingService, ExamJudge } from "@decks/core";
import type { DecksSettings } from "../settings";
import type { AiKeyStore } from "./AiKeyStore";
import { buildAiConfig } from "./ai-config";

/** Whether "By meaning" grading can be offered; it runs on the hosted provider only. */
export function meaningGradingAvailable(settings: DecksSettings): boolean {
  return settings.ai.enabled && settings.ai.provider === "decks-pro";
}

/** Plugin glue for grading typed exam answers by meaning. Never throws: without
 *  a judge the student grades those answers themselves. */
export class AiGradingController {
  constructor(
    private readonly service: AiGradingService,
    private readonly settings: DecksSettings,
    private readonly keyStore: AiKeyStore,
  ) {}

  isAvailable(): boolean {
    return meaningGradingAvailable(this.settings);
  }

  async judge(): Promise<ExamJudge | null> {
    if (!this.isAvailable()) return null;
    try {
      const config = await buildAiConfig(this.settings, this.keyStore);
      if (!config.apiKey) return null;
      return (items, signal) => this.service.grade(config, items, signal);
    } catch (e) {
      console.debug("Decks: answer check unavailable", e);
      return null;
    }
  }
}
