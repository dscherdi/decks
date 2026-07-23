// Read-aloud engine for the review play button. The only place that touches
// the browser speech API, so core stays platform-agnostic. Feature-detected so
// it degrades to a no-op where the API is unavailable (e.g. some mobile
// webviews); callers hide the button when isAvailable() is false.

export interface TtsSpeakConfig {
  // Platform voice identifier (SpeechSynthesisVoice.voiceURI).
  voiceURI?: string;
  // Playback speed; clamped to the browser's supported range.
  rate?: number;
  // BCP-47 fallback used to pick a voice when voiceURI is unavailable here.
  lang?: string;
}

export interface TtsSpeakHandlers {
  onStart?: () => void;
  onEnd?: () => void;
}

export class TtsService {
  private voices: SpeechSynthesisVoice[] = [];
  private voicesLoaded = false;

  constructor() {
    if (!this.isAvailable()) return;
    this.refreshVoices();
    // Voices populate asynchronously in Chromium; refresh when they arrive.
    try {
      window.speechSynthesis.addEventListener("voiceschanged", this.refreshVoices);
    } catch {
      // Some environments lack the event; listVoices() re-queries lazily.
    }
  }

  isAvailable(): boolean {
    return (
      typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      typeof SpeechSynthesisUtterance !== "undefined"
    );
  }

  private refreshVoices = (): void => {
    if (!this.isAvailable()) return;
    const list = window.speechSynthesis.getVoices();
    if (list.length > 0) {
      this.voices = list;
      this.voicesLoaded = true;
    }
  };

  listVoices(): SpeechSynthesisVoice[] {
    if (!this.voicesLoaded) this.refreshVoices();
    return this.voices;
  }

  // Best available voice for the config: exact voiceURI, else a lang match
  // (full tag then primary subtag), else null (OS default).
  private resolveVoice(config: TtsSpeakConfig): SpeechSynthesisVoice | null {
    const voices = this.listVoices();
    if (voices.length === 0) return null;
    if (config.voiceURI) {
      const exact = voices.find((v) => v.voiceURI === config.voiceURI);
      if (exact) return exact;
    }
    if (config.lang) {
      const lang = config.lang.toLowerCase();
      const primary = lang.split("-")[0];
      const byLang =
        voices.find((v) => v.lang.toLowerCase() === lang) ??
        voices.find((v) => v.lang.toLowerCase().startsWith(primary));
      if (byLang) return byLang;
    }
    return null;
  }

  speak(text: string, config: TtsSpeakConfig = {}, handlers?: TtsSpeakHandlers): void {
    if (!this.isAvailable() || !text.trim()) return;
    this.stop();

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = this.resolveVoice(config);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else if (config.lang) {
      utterance.lang = config.lang;
    }
    if (typeof config.rate === "number" && isFinite(config.rate)) {
      utterance.rate = Math.min(2, Math.max(0.5, config.rate));
    }
    if (handlers?.onStart) utterance.onstart = () => handlers.onStart?.();
    if (handlers?.onEnd) {
      const finish = () => handlers.onEnd?.();
      utterance.onend = finish;
      utterance.onerror = finish;
    }

    window.speechSynthesis.speak(utterance);
  }

  stop(): void {
    if (!this.isAvailable()) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Cancelling an idle queue can throw in some engines; safe to ignore.
    }
  }

  isSpeaking(): boolean {
    return this.isAvailable() && window.speechSynthesis.speaking;
  }

  dispose(): void {
    if (!this.isAvailable()) return;
    try {
      window.speechSynthesis.removeEventListener("voiceschanged", this.refreshVoices);
    } catch {
      // Ignore: listener may never have attached.
    }
    this.stop();
  }
}

// Stateless singleton wrapping the global speech engine; imported by the review
// hosts and the profiles editor rather than threaded through every view.
export const ttsService = new TtsService();
