import {
  AiGenerationService,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
} from "@decks/core";
import { AiGeneratorController } from "@/services/AiGeneratorController";
import { DEFAULT_SETTINGS, type DecksSettings } from "@/settings";
import type { AiKeyStore } from "@/services/AiKeyStore";

// OpenAI-style SSE carrying the delimited card format the parser expects.
function sseFor(cards: Array<[string, string]>): string {
  const content = cards
    .map(([front, back]) => `FRONT: ${front}\nBACK: ${back}\n===END===\n`)
    .join("");
  return (
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n` +
    "data: [DONE]\n\n"
  );
}

// Streams a scripted SSE response per round; out-of-range rounds emit nothing.
class BatchHttp implements HttpClient {
  public requests: HttpRequest[] = [];
  public calls = 0;
  constructor(private readonly scripts: string[]) {}
  async request(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    return {
      status: 200,
      text: JSON.stringify({ choices: [{ message: { content: "" } }] }),
    };
  }
  async stream(req: HttpRequest, onChunk: (t: string) => void): Promise<void> {
    this.requests.push(req);
    onChunk(this.scripts[this.calls] ?? "data: [DONE]\n\n");
    this.calls++;
  }
}

// Minimal key store double; the real one needs a vault adapter.
const keyStore = { get: async () => "k" } as unknown as AiKeyStore;

function controllerFor(
  http: HttpClient,
  overrides: Partial<DecksSettings["ai"]> = {},
): AiGeneratorController {
  const settings: DecksSettings = {
    ...DEFAULT_SETTINGS,
    ai: { ...DEFAULT_SETTINGS.ai, provider: "openai", ...overrides },
  };
  return new AiGeneratorController(
    new AiGenerationService(http),
    settings,
    keyStore,
  );
}

const collect = () => {
  const cards: string[] = [];
  return {
    fronts: cards,
    handlers: { onCard: (c: { front: string }) => cards.push(c.front) },
  };
};

describe("AiGeneratorController iterative batch loop", () => {
  it("accumulates new cards across rounds and dedups repeats", async () => {
    const http = new BatchHttp([
      sseFor([["Q1", "A1"], ["Q2", "A2"]]), // round 1: two new
      sseFor([["Q2", "A2"], ["Q3", "A3"]]), // round 2: Q2 dup, Q3 new
      sseFor([["Q1", "A1"], ["Q3", "A3"]]), // round 3: all dups -> stop
    ]);
    const { fronts, handlers } = collect();

    const result = await controllerFor(http).generateStream(
      { prompt: "go", maxBatches: 5 },
      handlers,
    );

    expect(result.cards.map((c) => c.front)).toEqual(["Q1", "Q2", "Q3"]);
    // onCard fired once per unique card, never for a duplicate.
    expect(fronts).toEqual(["Q1", "Q2", "Q3"]);
    // Stopped after the dud round rather than running all 5.
    expect(http.calls).toBe(3);
  });

  it("feeds cards-so-far back as an assistant turn on later rounds", async () => {
    const http = new BatchHttp([
      sseFor([["Q1", "A1"]]),
      sseFor([["Q2", "A2"]]),
      sseFor([]), // empty -> stop
    ]);
    await controllerFor(http).generateStream(
      { prompt: "go", maxBatches: 5 },
      collect().handlers,
    );

    const round1 = JSON.parse(http.requests[0].body ?? "{}");
    const round2 = JSON.parse(http.requests[1].body ?? "{}");
    // Round 1 has no assistant turn; round 2 carries the prior card.
    expect(round1.messages.some((m: { role: string }) => m.role === "assistant")).toBe(
      false,
    );
    const assistant = round2.messages.find(
      (m: { role: string }) => m.role === "assistant",
    );
    expect(assistant?.content).toContain("Q1");
  });

  it("seeds dedup + context from existingCards without re-emitting them", async () => {
    const http = new BatchHttp([
      sseFor([["Q1", "A1"], ["Q2", "A2"]]), // Q1 is already known
      sseFor([]),
    ]);
    const { fronts, handlers } = collect();

    const result = await controllerFor(http).generateStream(
      {
        prompt: "go",
        maxBatches: 5,
        existingCards: [{ front: "Q1", back: "A1", notes: "" }],
      },
      handlers,
    );

    // Only the genuinely new card surfaces.
    expect(result.cards.map((c) => c.front)).toEqual(["Q2"]);
    expect(fronts).toEqual(["Q2"]);
    // The known card was fed to the model from round 1.
    const round1 = JSON.parse(http.requests[0].body ?? "{}");
    const assistant = round1.messages.find(
      (m: { role: string }) => m.role === "assistant",
    );
    expect(assistant?.content).toContain("Q1");
  });

  it("runs a single round by default (maxBatches omitted)", async () => {
    const http = new BatchHttp([
      sseFor([["Q1", "A1"]]),
      sseFor([["Q2", "A2"]]),
    ]);
    const result = await controllerFor(http).generateStream(
      { prompt: "go" },
      collect().handlers,
    );
    expect(result.cards.map((c) => c.front)).toEqual(["Q1"]);
    expect(http.calls).toBe(1);
  });
});
