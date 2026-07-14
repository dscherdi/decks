import { App, TFile } from "obsidian";
import type { Flashcard, IDatabaseService } from "@decks/core";
import {
  FlashcardParser,
  clozeBindingKey,
  edgeBindingKey,
  extractAnchorTokens,
  formatAnchorToken,
  generateAnchorId,
  generateClozeFlashcardId,
  generateFlashcardId,
  headerBindingKey,
  nodeBindingKey,
  occlusionBindingKey,
  parseHeaderLevels,
  reverseBindingKey,
  splitTableLine,
  stripAnchorTokens,
  tableBindingKey,
  titleBindingKey,
  titleClozeBindingKey,
  unescapeTableCell,
} from "@decks/core";
import { findFlashcardSegment } from "../utils/source-navigator";
import type { Logger } from "../utils/logging";

export type StampOutcome =
  | { ok: true; anchorKey: string; adopted: boolean }
  | {
      ok: false;
      reason:
        | "not_stampable"
        | "already_anchored"
        | "file_missing"
        | "stale"
        | "ambiguous_front"
        | "segment_not_found"
        | "binding_conflict"
        | "write_failed";
    };

interface BindingRow {
  anchor: string;
  flashcardId: string;
}

interface StampPlan {
  tokenRole: "h" | "c" | "t" | "o";
  tokenId: string;
  cardKey: string;
  bindings: BindingRow[];
}

const HEADER_LINE_REGEX = /^(#{1,6})\s+(.*)$/;
const CLOZE_REGEX = /==((?:(?!==).)+)==/g;
const TABLE_ROW_REGEX = /^\|.*\|$/;
const MAX_MINT_ATTEMPTS = 10;

/**
 * Writes a card's anchor token into its source at review time and records the
 * durable anchor binding. Every failure is silent and non-blocking — the next
 * review retries.
 */
export class AnchorStamper {
  constructor(
    private app: App,
    private db: IDatabaseService,
    private logger?: Logger
  ) {}

  async ensureAnchored(card: Flashcard): Promise<StampOutcome> {
    try {
      const outcome = await this.stamp(card);
      if (!outcome.ok && outcome.reason !== "already_anchored") {
        this.logger?.debug(
          `Anchor stamp skipped for ${card.id}: ${outcome.reason}`
        );
      }
      return outcome;
    } catch (error) {
      this.logger?.debug(`Anchor stamp failed for ${card.id}`, error);
      return { ok: false, reason: "write_failed" };
    }
  }

  private async stamp(card: Flashcard): Promise<StampOutcome> {
    // A card whose locator column is already set only needs its binding
    // ensured (canvas cards and merge races land here).
    if (card.anchor) {
      return this.bindExistingKey(card, card.anchor);
    }

    if (card.type === "image-occlusion-v2") {
      return { ok: false, reason: "not_stampable" };
    }

    if (card.edgeId) {
      const key = edgeBindingKey(
        card.edgeId,
        card.type === "cloze" ? card.clozeOrder ?? 0 : undefined
      );
      return this.bindExistingKey(card, key);
    }

    if (card.sourceNodeId) {
      if (card.type === "cloze") return { ok: false, reason: "not_stampable" };
      const count = await this.db.countNodeCards(
        card.deckId,
        card.sourceNodeId
      );
      if (count !== 1) return { ok: false, reason: "not_stampable" };
      return this.bindExistingKey(card, nodeBindingKey(card.sourceNodeId));
    }

    const deck = await this.db.getDeckWithProfile(card.deckId);
    if (!deck) return { ok: false, reason: "not_stampable" };
    if (parseHeaderLevels(deck.profile).includes(0)) {
      return this.stampTitleMode(card);
    }

    return this.stampMarkdown(card);
  }

  /** DB-only path: adopt-or-insert a binding for a key the card already owns. */
  private async bindExistingKey(
    card: Flashcard,
    key: string
  ): Promise<StampOutcome> {
    const bound = await this.db.getAnchorBinding(key);
    if (bound === card.id) {
      if (card.anchor !== key) {
        await this.db.setFlashcardAnchor(card.id, key);
        card.anchor = key;
      }
      return { ok: false, reason: "already_anchored" };
    }
    if (bound !== null) return { ok: false, reason: "binding_conflict" };
    await this.db.insertAnchorBindings([{ anchor: key, flashcardId: card.id }]);
    await this.db.setFlashcardAnchor(card.id, key);
    card.anchor = key;
    return { ok: true, anchorKey: key, adopted: true };
  }

  /** Title-mode cards anchor via the frontmatter `decks-id` property. */
  private async stampTitleMode(card: Flashcard): Promise<StampOutcome> {
    const file = this.app.vault.getAbstractFileByPath(card.sourceFile);
    if (!(file instanceof TFile)) return { ok: false, reason: "file_missing" };

    const baseFront = card.id.startsWith("rcard_") ? card.back : card.front;
    let titleId = await this.mintId(baseFront, "");
    if (titleId === null) return { ok: false, reason: "write_failed" };

    const { preMtime, lastSynced } = await this.readMtimeState(file, card.deckId);
    let adopted = false;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const existing = fm["decks-id"];
      if (typeof existing === "string" && existing.length > 0) {
        titleId = existing;
        adopted = true;
      } else {
        fm["decks-id"] = titleId;
      }
    });
    await this.suppressMtimeIfClean(file, card.deckId, preMtime, lastSynced);

    const baseKey = titleBindingKey(titleId);
    let cardKey: string;
    if (card.id.startsWith("rcard_")) {
      cardKey = reverseBindingKey(baseKey);
    } else if (card.type === "cloze") {
      cardKey = titleClozeBindingKey(titleId, card.clozeOrder ?? 0);
    } else {
      cardKey = baseKey;
    }
    const bound = await this.db.getAnchorBinding(cardKey);
    if (bound !== null && bound !== card.id) {
      return { ok: false, reason: "binding_conflict" };
    }
    await this.db.insertAnchorBindings([
      { anchor: cardKey, flashcardId: card.id },
    ]);
    await this.db.setFlashcardAnchor(card.id, cardKey);
    card.anchor = cardKey;
    return { ok: true, anchorKey: cardKey, adopted };
  }

  /** Markdown cards (header, cloze, table, occlusion): token into the file. */
  private async stampMarkdown(card: Flashcard): Promise<StampOutcome> {
    const file = this.app.vault.getAbstractFileByPath(card.sourceFile);
    if (!(file instanceof TFile)) return { ok: false, reason: "file_missing" };

    const isReverse = card.id.startsWith("rcard_");
    const hostFront = isReverse ? card.back : card.front;
    const hostBack = isReverse ? card.front : card.back;

    const content = await this.app.vault.cachedRead(file);
    const lines = content.split("\n");

    if (this.hasAmbiguousHost(card, lines, hostFront)) {
      return { ok: false, reason: "ambiguous_front" };
    }

    const mintInput = this.mintInputFor(card, lines, hostFront);
    const tokenId = await this.mintId(mintInput, content);
    if (tokenId === null) return { ok: false, reason: "write_failed" };

    const plan = await this.buildPlan(card, tokenId, hostFront);
    if (!plan) return { ok: false, reason: "not_stampable" };

    const { preMtime, lastSynced } = await this.readMtimeState(file, card.deckId);
    let outcome: StampOutcome = { ok: false, reason: "write_failed" };
    let bindings: BindingRow[] = [];
    await this.app.vault.process(file, (current) => {
      const result = this.applyStamp(current, card, hostFront, hostBack, plan);
      outcome = result.outcome;
      bindings = result.bindings;
      return result.content;
    });

    const finalOutcome: StampOutcome = outcome;
    if (!finalOutcome.ok) return finalOutcome;

    await this.suppressMtimeIfClean(file, card.deckId, preMtime, lastSynced);
    await this.db.insertAnchorBindings(bindings);
    for (const row of bindings) {
      const existing = await this.db.getFlashcardById(row.flashcardId);
      if (existing) {
        await this.db.setFlashcardAnchor(row.flashcardId, row.anchor);
      }
    }
    card.anchor = finalOutcome.anchorKey;
    return finalOutcome;
  }

  private isTableCard(card: Flashcard): boolean {
    return card.type === "table" || card.templateRow != null;
  }

  private hasAmbiguousHost(
    card: Flashcard,
    lines: string[],
    hostFront: string
  ): boolean {
    if (this.isTableCard(card)) {
      return this.countTableRowMatches(lines, hostFront) > 1;
    }
    if (card.type === "image-occlusion") {
      // The item-level stale check (clozeText compare) self-guards mislocation.
      return false;
    }
    return this.countHeaderMatches(lines, hostFront) > 1;
  }

  private mintInputFor(
    card: Flashcard,
    lines: string[],
    hostFront: string
  ): string {
    if (card.type === "image-occlusion") return card.clozeText ?? hostFront;
    if (card.type === "cloze" && !this.isTableCard(card)) {
      return this.findClozeLineText(lines, card) ?? hostFront;
    }
    return hostFront;
  }

  /**
   * Stamp several markdown cards of one file in a single write (used by the
   * one-time migrator). Cards must share `sourceFile` and be unanchored.
   */
  async stampFileBatch(
    file: TFile,
    cards: Flashcard[]
  ): Promise<{ stamped: number; skipped: number }> {
    let skipped = 0;
    const content = await this.app.vault.cachedRead(file);
    const lines = content.split("\n");

    const jobs: {
      card: Flashcard;
      hostFront: string;
      hostBack: string;
      plan: StampPlan;
    }[] = [];
    for (const card of cards) {
      const isReverse = card.id.startsWith("rcard_");
      const hostFront = isReverse ? card.back : card.front;
      if (this.hasAmbiguousHost(card, lines, hostFront)) {
        skipped++;
        continue;
      }
      const mintInput = this.mintInputFor(card, lines, hostFront);
      const tokenId = await this.mintId(mintInput, content);
      if (tokenId === null) {
        skipped++;
        continue;
      }
      const plan = await this.buildPlan(card, tokenId, hostFront);
      if (!plan) {
        skipped++;
        continue;
      }
      jobs.push({
        card,
        hostFront,
        hostBack: isReverse ? card.front : card.back,
        plan,
      });
    }
    if (jobs.length === 0) return { stamped: 0, skipped };

    const deckId = cards[0].deckId;
    const { preMtime, lastSynced } = await this.readMtimeState(file, deckId);
    const allBindings: BindingRow[] = [];
    const stampedCards: { card: Flashcard; key: string }[] = [];
    await this.app.vault.process(file, (initial) => {
      let current = initial;
      for (const job of jobs) {
        const result = this.applyStamp(
          current,
          job.card,
          job.hostFront,
          job.hostBack,
          job.plan
        );
        if (result.outcome.ok) {
          current = result.content;
          allBindings.push(...result.bindings);
          stampedCards.push({ card: job.card, key: result.outcome.anchorKey });
        } else {
          skipped++;
          this.logger?.debug(
            `Anchor migration skipped ${job.card.id}: ${result.outcome.reason}`
          );
        }
      }
      return current;
    });

    await this.suppressMtimeIfClean(file, deckId, preMtime, lastSynced);
    await this.db.insertAnchorBindings(allBindings);
    for (const row of allBindings) {
      const existing = await this.db.getFlashcardById(row.flashcardId);
      if (existing) {
        await this.db.setFlashcardAnchor(row.flashcardId, row.anchor);
      }
    }
    for (const s of stampedCards) s.card.anchor = s.key;
    return { stamped: stampedCards.length, skipped };
  }

  /** Deterministic mint with occurrence salting against file/binding collisions. */
  private async mintId(
    input: string,
    fileContent: string
  ): Promise<string | null> {
    for (let occurrence = 0; occurrence < MAX_MINT_ATTEMPTS; occurrence++) {
      const candidate = generateAnchorId(input, occurrence);
      if (fileContent.includes(`:${candidate}%%`)) continue;
      const conflicts = await Promise.all([
        this.db.getAnchorBinding(headerBindingKey(candidate)),
        this.db.getAnchorBinding(clozeBindingKey(candidate, 0)),
        this.db.getAnchorBinding(tableBindingKey(candidate)),
        this.db.getAnchorBinding(tableBindingKey(candidate, 0)),
        this.db.getAnchorBinding(occlusionBindingKey(candidate)),
      ]);
      if (conflicts.some((id) => id !== null)) continue;
      return candidate;
    }
    return null;
  }

  private async buildPlan(
    card: Flashcard,
    tokenId: string,
    hostFront: string
  ): Promise<StampPlan | null> {
    if (card.type === "image-occlusion") {
      return {
        tokenRole: "o",
        tokenId,
        cardKey: occlusionBindingKey(tokenId),
        bindings: [],
      };
    }
    if (this.isTableCard(card)) {
      const tableKey = tableBindingKey(tokenId);
      let cardKey: string;
      if (card.id.startsWith("rcard_")) {
        cardKey = reverseBindingKey(tableKey);
      } else if (card.type === "cloze") {
        cardKey = tableBindingKey(tokenId, card.clozeOrder ?? 0);
      } else {
        cardKey = tableKey;
      }
      // Bindings are computed at apply time from the located row's cells.
      return { tokenRole: "t", tokenId, cardKey, bindings: [] };
    }
    if (card.type === "cloze") {
      return {
        tokenRole: "c",
        tokenId,
        cardKey: clozeBindingKey(tokenId, 0),
        bindings: [],
      };
    }
    const baseKey = headerBindingKey(tokenId);
    if (card.id.startsWith("rcard_")) {
      const bindings: BindingRow[] = [
        { anchor: reverseBindingKey(baseKey), flashcardId: card.id },
      ];
      const baseId = generateFlashcardId(hostFront);
      const baseCard = await this.db.getFlashcardById(baseId);
      if (baseCard) bindings.push({ anchor: baseKey, flashcardId: baseId });
      return {
        tokenRole: "h",
        tokenId,
        cardKey: reverseBindingKey(baseKey),
        bindings,
      };
    }
    return {
      tokenRole: "h",
      tokenId,
      cardKey: baseKey,
      bindings: [{ anchor: baseKey, flashcardId: card.id }],
    };
  }

  private applyStamp(
    content: string,
    card: Flashcard,
    hostFront: string,
    hostBack: string,
    plan: StampPlan
  ): { content: string; outcome: StampOutcome; bindings: BindingRow[] } {
    if (plan.tokenRole === "t") {
      return this.applyTableStamp(content, card, hostFront, hostBack, plan);
    }
    if (plan.tokenRole === "o") {
      return this.applyOcclusionStamp(content, card, plan);
    }

    const unchanged = (reason: StampOutcome & { ok: false }): {
      content: string;
      outcome: StampOutcome;
      bindings: BindingRow[];
    } => ({ content, outcome: reason, bindings: [] });

    const lines = content.split("\n");
    const segment = findFlashcardSegment(lines, {
      type: card.type === "cloze" ? "cloze" : "header-paragraph",
      front: hostFront,
      breadcrumb: card.breadcrumb,
      clozeOrder: card.clozeOrder ?? null,
    });
    if (!segment) return unchanged({ ok: false, reason: "segment_not_found" });

    // A cloze whose segment resolves to a table row belongs to the t path.
    // Route rather than reject: templateRow may be missing on older rows, and
    // the segment itself proves the host is a table.
    if (
      segment.end - segment.start === 1 &&
      TABLE_ROW_REGEX.test(lines[segment.start].trim())
    ) {
      return this.applyTableStamp(content, card, hostFront, hostBack, {
        tokenRole: "t",
        tokenId: plan.tokenId,
        cardKey: tableBindingKey(plan.tokenId, card.clozeOrder ?? 0),
        bindings: [],
      });
    }

    const bodyStart = segment.start + 1;
    const bodyLines = lines.slice(bodyStart, segment.end);
    const cleanBody = bodyLines.map((l) => stripAnchorTokens(l));
    const parsedBody = FlashcardParser.extractHeaderParagraphNotes(
      cleanBody.join("\n").trim()
    );
    if (parsedBody.back.trim() !== hostBack.trim()) {
      return unchanged({ ok: false, reason: "stale" });
    }

    if (plan.tokenRole === "h") {
      // Adopt semantics mirror the parser: the first h token anywhere in the
      // body owns the card, wherever the user has moved it.
      for (const bodyLine of bodyLines) {
        const existing = extractAnchorTokens(bodyLine).tokens.find(
          (t) => t.role === "h"
        );
        if (existing) {
          const adoptedKey = card.id.startsWith("rcard_")
            ? reverseBindingKey(headerBindingKey(existing.id))
            : headerBindingKey(existing.id);
          return {
            content,
            outcome: { ok: true, anchorKey: adoptedKey, adopted: true },
            bindings: this.rekeyBindings(plan, existing.id),
          };
        }
      }
      let target = -1;
      for (let i = bodyLines.length - 1; i >= 0; i--) {
        if (bodyLines[i].trim() !== "") {
          target = i;
          break;
        }
      }
      if (target === -1) {
        return unchanged({ ok: false, reason: "segment_not_found" });
      }
      // The token gets its own line directly after the body.
      lines.splice(
        bodyStart + target + 1,
        0,
        formatAnchorToken("h", plan.tokenId)
      );
      return {
        content: lines.join("\n"),
        outcome: { ok: true, anchorKey: plan.cardKey, adopted: false },
        bindings: plan.bindings,
      };
    }

    // Cloze: locate the body line holding match #clozeOrder and its
    // within-line index, then token that line and bind every sibling on it.
    const located = this.locateCloze(cleanBody, card.clozeOrder ?? 0);
    if (!located) return unchanged({ ok: false, reason: "stale" });

    const rawLine = bodyLines[located.lineIndex];
    const existing = extractAnchorTokens(rawLine).tokens.find(
      (t) => t.role === "c"
    );
    const tokenId = existing ? existing.id : plan.tokenId;
    const bindings = this.clozeSiblingBindings(
      hostFront,
      cleanBody,
      located.lineIndex,
      tokenId
    );
    const cardKey = clozeBindingKey(tokenId, located.indexInLine);
    if (existing) {
      return {
        content,
        outcome: { ok: true, anchorKey: cardKey, adopted: true },
        bindings,
      };
    }
    lines[bodyStart + located.lineIndex] =
      rawLine + " " + formatAnchorToken("c", tokenId);
    return {
      content: lines.join("\n"),
      outcome: { ok: true, anchorKey: cardKey, adopted: false },
      bindings,
    };
  }

  /** Re-point a plan's bindings at an adopted token id. */
  private rekeyBindings(plan: StampPlan, adoptedId: string): BindingRow[] {
    const baseKey = headerBindingKey(adoptedId);
    return plan.bindings.map((row) => ({
      flashcardId: row.flashcardId,
      anchor: row.anchor.endsWith(":rev")
        ? reverseBindingKey(baseKey)
        : baseKey,
    }));
  }

  /** Swap the token id inside a binding key, keeping role and suffix. */
  private rekeyCardKey(cardKey: string, adoptedId: string): string {
    return cardKey.replace(/^([hcto]):[a-z0-9]+/, `$1:${adoptedId}`);
  }

  /** Table rows: token written into the first data cell, located by row scan. */
  private applyTableStamp(
    content: string,
    card: Flashcard,
    hostFront: string,
    hostBack: string,
    plan: StampPlan
  ): { content: string; outcome: StampOutcome; bindings: BindingRow[] } {
    const unchanged = (reason: StampOutcome & { ok: false }): {
      content: string;
      outcome: StampOutcome;
      bindings: BindingRow[];
    } => ({ content, outcome: reason, bindings: [] });

    const lines = content.split("\n");
    const segment = findFlashcardSegment(lines, {
      type: card.type === "cloze" ? "cloze" : "table",
      front: hostFront,
      breadcrumb: card.breadcrumb,
      clozeOrder: card.clozeOrder ?? null,
    });
    if (!segment) return unchanged({ ok: false, reason: "segment_not_found" });

    const rawLine = lines[segment.start];
    const leading = /^\s*/.exec(rawLine)?.[0] ?? "";
    const trimmedRow = rawLine.trim();
    if (!TABLE_ROW_REGEX.test(trimmedRow)) {
      return unchanged({ ok: false, reason: "segment_not_found" });
    }

    // Raw segments (outer empties included) so every untouched cell survives
    // byte-for-byte; cleaned cells mirror the parser for comparisons.
    const rawCells = splitTableLine(trimmedRow);
    const dataCells = rawCells
      .slice(1, -1)
      .map((c) => unescapeTableCell(stripAnchorTokens(c).trim()));
    if (card.templateRow) {
      if (JSON.stringify(dataCells) !== JSON.stringify(card.templateRow.cells)) {
        return unchanged({ ok: false, reason: "stale" });
      }
    } else if (
      dataCells[0] !== hostFront ||
      (dataCells[1] ?? "") !== hostBack
    ) {
      return unchanged({ ok: false, reason: "stale" });
    }

    const existing = rawCells
      .flatMap((c) => extractAnchorTokens(c).tokens)
      .find((t) => t.role === "t");
    if (existing) {
      return {
        content,
        outcome: {
          ok: true,
          anchorKey: this.rekeyCardKey(plan.cardKey, existing.id),
          adopted: true,
        },
        bindings: this.tableBindings(card, hostFront, dataCells, existing.id),
      };
    }

    const next = [...rawCells];
    next[1] =
      next[1].replace(/\s*$/, "") +
      " " +
      formatAnchorToken("t", plan.tokenId) +
      " ";
    lines[segment.start] = leading + next.join("|");
    return {
      content: lines.join("\n"),
      outcome: { ok: true, anchorKey: plan.cardKey, adopted: false },
      bindings: this.tableBindings(card, hostFront, dataCells, plan.tokenId),
    };
  }

  /**
   * Deterministic bindings for a table row: the plain/reverse pair, or every
   * cloze in the row's cloze cell (mirrors the parser's cell choice).
   */
  private tableBindings(
    card: Flashcard,
    hostFront: string,
    dataCells: string[],
    tokenId: string
  ): BindingRow[] {
    if (card.type === "cloze") {
      const frontIsCloze = new RegExp(CLOZE_REGEX.source).test(dataCells[0]);
      const clozeSource = frontIsCloze ? dataCells[0] : dataCells[1] ?? "";
      const rows: BindingRow[] = [];
      const regex = new RegExp(CLOZE_REGEX.source, "g");
      let match: RegExpExecArray | null;
      let order = 0;
      while ((match = regex.exec(clozeSource)) !== null) {
        rows.push({
          anchor: tableBindingKey(tokenId, order),
          flashcardId: generateClozeFlashcardId(hostFront, match[1], order),
        });
        order++;
      }
      return rows;
    }
    const tableKey = tableBindingKey(tokenId);
    if (card.id.startsWith("rcard_")) {
      return [
        { anchor: reverseBindingKey(tableKey), flashcardId: card.id },
        { anchor: tableKey, flashcardId: generateFlashcardId(hostFront) },
      ];
    }
    return [{ anchor: tableKey, flashcardId: card.id }];
  }

  /** Occlusion v1 items: token appended to the numbered list line. */
  private applyOcclusionStamp(
    content: string,
    card: Flashcard,
    plan: StampPlan
  ): { content: string; outcome: StampOutcome; bindings: BindingRow[] } {
    const unchanged = (reason: StampOutcome & { ok: false }): {
      content: string;
      outcome: StampOutcome;
      bindings: BindingRow[];
    } => ({ content, outcome: reason, bindings: [] });

    const lines = content.split("\n");
    const segment = findFlashcardSegment(lines, {
      type: "image-occlusion",
      front: card.front,
      breadcrumb: card.breadcrumb,
      clozeOrder: card.clozeOrder ?? null,
    });
    if (!segment) return unchanged({ ok: false, reason: "segment_not_found" });

    const rawLine = lines[segment.start];
    const itemMatch = /^\d+\.\s+(.+)$/.exec(stripAnchorTokens(rawLine).trim());
    if (!itemMatch) return unchanged({ ok: false, reason: "stale" });
    const currentCloze = itemMatch[1]
      .trim()
      .replace(/==((?:(?!==).)+)==/g, "$1");
    if (currentCloze !== (card.clozeText ?? "")) {
      return unchanged({ ok: false, reason: "stale" });
    }

    const existing = extractAnchorTokens(rawLine).tokens.find(
      (t) => t.role === "o"
    );
    if (existing) {
      return {
        content,
        outcome: {
          ok: true,
          anchorKey: occlusionBindingKey(existing.id),
          adopted: true,
        },
        bindings: [
          { anchor: occlusionBindingKey(existing.id), flashcardId: card.id },
        ],
      };
    }

    lines[segment.start] =
      rawLine + " " + formatAnchorToken("o", plan.tokenId);
    return {
      content: lines.join("\n"),
      outcome: { ok: true, anchorKey: plan.cardKey, adopted: false },
      bindings: [
        { anchor: occlusionBindingKey(plan.tokenId), flashcardId: card.id },
      ],
    };
  }

  /** Whole-file count of table rows whose cleaned first cell equals `front`. */
  private countTableRowMatches(lines: string[], front: string): number {
    let count = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!TABLE_ROW_REGEX.test(trimmed)) continue;
      const cells = splitTableLine(trimmed.slice(1, -1));
      if (cells.length === 0) continue;
      const first = unescapeTableCell(stripAnchorTokens(cells[0]).trim());
      if (first === front) count++;
    }
    return count;
  }

  /** Map a body-scoped cloze order to its line and within-line index. */
  private locateCloze(
    cleanBody: string[],
    clozeOrder: number
  ): { lineIndex: number; indexInLine: number } | null {
    let order = 0;
    for (let lineIndex = 0; lineIndex < cleanBody.length; lineIndex++) {
      const regex = new RegExp(CLOZE_REGEX.source, "g");
      let indexInLine = 0;
      while (regex.exec(cleanBody[lineIndex]) !== null) {
        if (order === clozeOrder) return { lineIndex, indexInLine };
        order++;
        indexInLine++;
      }
    }
    return null;
  }

  /**
   * Deterministic bindings for every cloze on the tokened line: both devices
   * derive identical rows, so concurrent stamping stays merge-safe.
   */
  private clozeSiblingBindings(
    hostFront: string,
    cleanBody: string[],
    targetLine: number,
    tokenId: string
  ): BindingRow[] {
    const rows: BindingRow[] = [];
    let order = 0;
    for (let lineIndex = 0; lineIndex < cleanBody.length; lineIndex++) {
      const regex = new RegExp(CLOZE_REGEX.source, "g");
      let match: RegExpExecArray | null;
      let indexInLine = 0;
      while ((match = regex.exec(cleanBody[lineIndex])) !== null) {
        if (lineIndex === targetLine) {
          rows.push({
            anchor: clozeBindingKey(tokenId, indexInLine),
            flashcardId: generateClozeFlashcardId(hostFront, match[1], order),
          });
        }
        order++;
        indexInLine++;
      }
    }
    return rows;
  }

  private findClozeLineText(lines: string[], card: Flashcard): string | null {
    const segment = findFlashcardSegment(lines, {
      type: "cloze",
      front: card.front,
      breadcrumb: card.breadcrumb,
      clozeOrder: card.clozeOrder ?? null,
    });
    if (!segment) return null;
    const cleanBody = lines
      .slice(segment.start + 1, segment.end)
      .map((l) => stripAnchorTokens(l));
    const located = this.locateCloze(cleanBody, card.clozeOrder ?? 0);
    return located ? cleanBody[located.lineIndex].trim() : null;
  }

  private countHeaderMatches(lines: string[], front: string): number {
    let count = 0;
    for (const line of lines) {
      const match = HEADER_LINE_REGEX.exec(line);
      if (!match) continue;
      const { cleaned } = FlashcardParser.extractAndStripTags(
        stripAnchorTokens(match[2])
      );
      if (cleaned === front) count++;
    }
    return count;
  }

  private async readMtimeState(
    file: TFile,
    deckId: string
  ): Promise<{ preMtime: number; lastSynced: number }> {
    return {
      preMtime: file.stat.mtime,
      lastSynced: await this.db.getDeckLastSyncedMtime(deckId),
    };
  }

  /**
   * Suppress the resync a token-only write would trigger — but only when the
   * deck was clean, so a pending user edit is never swallowed.
   */
  private async suppressMtimeIfClean(
    file: TFile,
    deckId: string,
    preMtime: number,
    lastSynced: number
  ): Promise<void> {
    if (lastSynced !== preMtime) return;
    await this.db.setDeckLastSyncedMtime(deckId, file.stat.mtime);
  }
}
