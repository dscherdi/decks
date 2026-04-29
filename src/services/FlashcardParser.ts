export interface ParsedFlashcard {
  front: string;
  back: string;
  notes: string;
  type: "header-paragraph" | "table" | "cloze" | "image-occlusion";
  breadcrumb: string;
  tags: string[];
  isReverse?: boolean;
  clozeText?: string;
  clozeOrder?: number;
}

/**
 * FlashcardParser - Consolidated parsing logic for flashcards from markdown content
 * Supports table-based, header-paragraph, and cloze flashcards with configurable header levels
 */
export class FlashcardParser {
  // Pre-compiled regex patterns for better performance
  private static readonly HEADER_REGEX = /^(#{1,6})\s+/;
  private static readonly TABLE_ROW_REGEX = /^\|.*\|$/;
  private static readonly TABLE_SEPARATOR_REGEX = /^\|[\s-]+\|[\s-]+\|(?:[\s-]+\|)?$/;
  private static readonly CLOZE_REGEX = /==((?:(?!==).)+)==/g;
  private static readonly IMAGE_EMBED_REGEX = /^!\[\[.+\.(png|jpe?g|gif|svg|bmp|webp)\]\]$/i;
  private static readonly NUMBERED_LIST_REGEX = /^\d+\.\s+(.+)$/;
  // Obsidian tag syntax: must start with a letter, allows letters/digits/_/-//
  private static readonly HEADER_TAG_REGEX = /(?:^|\s)#([A-Za-z][A-Za-z0-9_\-/]*)/g;

  /**
   * Extract Obsidian-style tags from header text and return cleaned text.
   * - Tags ("#foo") are removed from the returned text.
   * - Returned tags are deduplicated and lowercased for case-insensitive filtering.
   */
  static extractAndStripTags(headerText: string): { cleaned: string; tags: string[] } {
    const tags: string[] = [];
    const cleaned = headerText
      .replace(FlashcardParser.HEADER_TAG_REGEX, (_match, tag: string) => {
        tags.push(tag);
        return " ";
      })
      .replace(/\s+/g, " ")
      .trim();
    const unique = Array.from(new Set(tags.map((t) => t.toLowerCase())));
    return { cleaned, tags: unique };
  }

  /**
   * Expand a card into cloze cards if cloze markers are found, otherwise return original card.
   * When cloze markers exist, returns N cloze cards (one per highlight) and NO regular card.
   * When no cloze markers exist, returns the original card unchanged.
   */
  private static expandClozes(
    front: string,
    back: string,
    notes: string,
    type: "header-paragraph" | "table",
    breadcrumb: string,
    tags: string[]
  ): ParsedFlashcard[] {
    const matches: { text: string; index: number }[] = [];
    let match: RegExpExecArray | null;
    const regex = new RegExp(FlashcardParser.CLOZE_REGEX.source, "g");

    while ((match = regex.exec(back)) !== null) {
      matches.push({ text: match[1], index: matches.length });
    }

    if (matches.length === 0) {
      return [{
        front,
        back,
        notes,
        type,
        breadcrumb,
        tags: [...tags],
      }];
    }

    return matches.map((m) => ({
      front,
      back,
      notes,
      type: "cloze" as const,
      breadcrumb,
      tags: [...tags],
      clozeText: m.text,
      clozeOrder: m.index,
    }));
  }

  /**
   * Parse flashcards from content string (optimized single-pass parsing)
   * @param content - Markdown content to parse
   * @param headerLevel - Target header level for header-paragraph flashcards (1-6, default: 2), or 0 for title mode
   * @param fileTitle - File title used as card front when headerLevel is 0 (title mode)
   * @param clozeEnabled - When true, ==highlighted== text generates cloze cards
   * @returns Array of parsed flashcards
   */
  static parseFlashcardsFromContent(
    content: string,
    headerLevel = 2,
    fileTitle?: string,
    clozeEnabled = false
  ): ParsedFlashcard[] {
    if (headerLevel === 0) {
      if (!fileTitle) return [];
      const back = FlashcardParser.stripFrontmatter(content).trim();
      if (clozeEnabled) {
        return FlashcardParser.expandClozes(fileTitle, back, "", "header-paragraph", "", []);
      }
      return [{
        front: fileTitle,
        back,
        notes: "",
        type: "header-paragraph",
        breadcrumb: "",
        tags: [],
      }];
    }

    const lines = content.split("\n");
    const flashcards: ParsedFlashcard[] = [];

    // Single pass through lines for both table and header parsing
    let inTable = false;
    let tableRowCount = 0;
    let currentHeader: { text: string; level: number; tags: string[] } | null = null;
    let currentContent: string[] = [];
    let inFrontmatter = false;
    let skipNextParagraph = false;
    let hasNonTableContent = false;

    // Header stack for breadcrumb tracking (text is already tag-stripped)
    const headerStack: Array<{ text: string; level: number; tags: string[] }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Handle frontmatter
      if (i === 0 && trimmedLine === "---") {
        inFrontmatter = true;
        continue;
      }
      if (inFrontmatter) {
        if (trimmedLine === "---") {
          inFrontmatter = false;
        }
        continue;
      }

      // Check for table rows
      if (FlashcardParser.TABLE_ROW_REGEX.test(trimmedLine)) {
        // Only parse table if we have a current header with the correct level AND no non-table content
        if (
          currentHeader &&
          currentHeader.level === headerLevel &&
          !hasNonTableContent
        ) {
          if (!inTable) {
            inTable = true;
            tableRowCount = 0;
          }

          tableRowCount++;

          // Skip first row (header) and second row (separator)
          if (tableRowCount <= 2) {
            continue;
          }

          // Parse table row
          const cells = trimmedLine
            .slice(1, -1) // Remove leading/trailing pipes
            .split("|")
            .map((cell) => cell.trim());

          if (cells.length >= 2 && cells[0] && cells[1]) {
            // Build breadcrumb from header stack (excluding the current header since it's the table container)
            const breadcrumb = headerStack.map((h) => h.text).join(" > ");
            const rowNotes = cells.length >= 3 ? (cells[2] || "") : "";
            const rowTags = currentHeader ? [...currentHeader.tags] : [];

            if (clozeEnabled) {
              const expanded = FlashcardParser.expandClozes(
                cells[0], cells[1], rowNotes, "table", breadcrumb, rowTags
              );
              flashcards.push(...expanded);
            } else {
              flashcards.push({
                front: cells[0],
                back: cells[1],
                notes: rowNotes,
                type: "table",
                breadcrumb,
                tags: rowTags,
              });
            }
          }
        } else {
          // Table under wrong header level or has non-table content - treat as regular content
          if (inTable) {
            inTable = false;
            tableRowCount = 0;
          }
          if (currentHeader) {
            // Skip empty lines at the beginning of content
            if (trimmedLine === "" && currentContent.length === 0) {
              continue;
            }
            currentContent.push(line);
          }
        }
      } else {
        // Not a table row, end table processing
        if (inTable) {
          inTable = false;
          tableRowCount = 0;
        }

        // Check for headers
        const headerMatch = FlashcardParser.HEADER_REGEX.exec(line);
        if (headerMatch) {
          const currentHeaderLevel = headerMatch[1].length;
          const rawHeaderText = line.replace(/^#{1,6}\s+/, "");
          const { cleaned: headerText, tags: headerTags } =
            FlashcardParser.extractAndStripTags(rawHeaderText);

          // Check for title headers to skip
          if (line.match(/^#\s+/) && line.toLowerCase().includes("flashcard")) {
            skipNextParagraph = true;
            // Build breadcrumb excluding the card's own header (last stack item)
            const breadcrumb = headerStack
              .slice(0, -1)
              .map((h) => h.text)
              .join(" > ");
            FlashcardParser.finalizeCurrentHeader(
              currentHeader,
              currentContent,
              flashcards,
              headerLevel,
              breadcrumb,
              clozeEnabled
            );
            currentHeader = null;
            currentContent = [];
            // Update header stack for H1 flashcard title
            while (
              headerStack.length > 0 &&
              headerStack[headerStack.length - 1].level >= currentHeaderLevel
            ) {
              headerStack.pop();
            }
            headerStack.push({ text: headerText, level: currentHeaderLevel, tags: headerTags });
            continue;
          }

          // Build breadcrumb excluding the card's own header (last stack item)
          const breadcrumb = headerStack
            .slice(0, -1)
            .map((h) => h.text)
            .join(" > ");

          // Finalize previous header
          FlashcardParser.finalizeCurrentHeader(
            currentHeader,
            currentContent,
            flashcards,
            headerLevel,
            breadcrumb,
            clozeEnabled
          );

          // Update header stack: pop all headers at same or deeper level
          while (
            headerStack.length > 0 &&
            headerStack[headerStack.length - 1].level >= currentHeaderLevel
          ) {
            headerStack.pop();
          }
          // Push current header onto stack (text is tag-stripped)
          headerStack.push({ text: headerText, level: currentHeaderLevel, tags: headerTags });

          // Start new header (text holds the original line for downstream front-text extraction)
          currentHeader = {
            text: line,
            level: currentHeaderLevel,
            tags: headerTags,
          };
          currentContent = [];
          hasNonTableContent = false;
          skipNextParagraph = false;
        } else if (skipNextParagraph) {
          if (trimmedLine === "") {
            skipNextParagraph = false;
          }
        } else if (currentHeader) {
          // Skip empty lines at the beginning of content
          if (trimmedLine === "" && currentContent.length === 0) {
            continue;
          }
          // Mark that we have non-table content under this header
          hasNonTableContent = true;
          currentContent.push(line);
        }
      }
    }

    // Finalize last header (exclude card's own header from breadcrumb)
    const finalBreadcrumb = headerStack
      .slice(0, -1)
      .map((h) => h.text)
      .join(" > ");
    FlashcardParser.finalizeCurrentHeader(
      currentHeader,
      currentContent,
      flashcards,
      headerLevel,
      finalBreadcrumb,
      clozeEnabled
    );

    return flashcards;
  }

  private static stripFrontmatter(content: string): string {
    const lines = content.split("\n");
    if (lines[0]?.trim() !== "---") return content;
    const end = lines.indexOf("---", 1);
    if (end === -1) return content;
    return lines.slice(end + 1).join("\n");
  }

  /**
   * Expand an image occlusion block into one card per numbered list item.
   * Each list item becomes one card regardless of how many ==cloze== markers it contains.
   * Items without ==cloze== markers use the full item text as the cloze text.
   */
  private static expandImageOcclusion(
    imageEmbed: string,
    back: string,
    listItems: string[],
    breadcrumb: string,
    tags: string[]
  ): ParsedFlashcard[] {
    const cards: ParsedFlashcard[] = [];
    let order = 0;

    for (const item of listItems) {
      const trimmed = item.trim();
      if (!trimmed) continue;

      const clozeText = trimmed.replace(/==((?:(?!==).)+)==/g, "$1");
      cards.push({
        front: imageEmbed,
        back,
        notes: "",
        type: "image-occlusion",
        breadcrumb,
        tags: [...tags],
        clozeText,
        clozeOrder: order,
      });
      order++;
    }

    return cards;
  }

  /**
   * Detect if content is an image occlusion block:
   * first non-empty line is an image embed, remaining non-empty lines are a numbered list.
   * Returns the image embed and list item texts, or null if not matched.
   */
  private static detectImageOcclusion(
    contentLines: string[]
  ): { imageEmbed: string; listItems: string[] } | null {
    const nonEmptyLines = contentLines
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (nonEmptyLines.length < 2) return null;

    if (!FlashcardParser.IMAGE_EMBED_REGEX.test(nonEmptyLines[0])) return null;

    const listItems: string[] = [];
    for (let i = 1; i < nonEmptyLines.length; i++) {
      const match = FlashcardParser.NUMBERED_LIST_REGEX.exec(nonEmptyLines[i]);
      if (!match) return null;
      listItems.push(match[1]);
    }

    return { imageEmbed: nonEmptyLines[0], listItems };
  }

  /**
   * Helper to finalize current header flashcard
   */
  private static finalizeCurrentHeader(
    currentHeader: { text: string; level: number; tags: string[] } | null,
    currentContent: string[],
    flashcards: ParsedFlashcard[],
    targetHeaderLevel: number,
    breadcrumb: string,
    clozeEnabled = false
  ): void {
    if (
      currentHeader &&
      currentContent.length > 0 &&
      currentHeader.level === targetHeaderLevel
    ) {
      const rawFront = currentHeader.text.replace(/^#{1,6}\s+/, "");
      const { cleaned: front } = FlashcardParser.extractAndStripTags(rawFront);
      const back = currentContent.join("\n").trim();
      const tags = [...currentHeader.tags];

      if (clozeEnabled) {
        const imageOcclusion = FlashcardParser.detectImageOcclusion(currentContent);
        if (imageOcclusion) {
          const backWithoutImage = currentContent
            .filter((l) => l.trim() !== imageOcclusion.imageEmbed)
            .join("\n")
            .trim();
          const imageOcclusionBreadcrumb = breadcrumb
            ? `${breadcrumb} > ${front}`
            : front;
          const expanded = FlashcardParser.expandImageOcclusion(
            imageOcclusion.imageEmbed, backWithoutImage, imageOcclusion.listItems, imageOcclusionBreadcrumb, tags
          );
          flashcards.push(...expanded);
          return;
        }

        const expanded = FlashcardParser.expandClozes(
          front, back, "", "header-paragraph", breadcrumb, tags
        );
        flashcards.push(...expanded);
      } else {
        flashcards.push({
          front,
          back,
          notes: "",
          type: "header-paragraph",
          breadcrumb,
          tags,
        });
      }
    }
  }
}
