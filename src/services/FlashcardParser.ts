export interface ParsedFlashcard {
  front: string;
  back: string;
  notes: string;
  type: "header-paragraph" | "table" | "cloze";
  breadcrumb: string;
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
    breadcrumb: string
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
      }];
    }

    return matches.map((m) => ({
      front,
      back,
      notes,
      type: "cloze" as const,
      breadcrumb,
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
        return FlashcardParser.expandClozes(fileTitle, back, "", "header-paragraph", "");
      }
      return [{
        front: fileTitle,
        back,
        notes: "",
        type: "header-paragraph",
        breadcrumb: "",
      }];
    }

    const lines = content.split("\n");
    const flashcards: ParsedFlashcard[] = [];

    // Single pass through lines for both table and header parsing
    let inTable = false;
    let tableRowCount = 0;
    let currentHeader: { text: string; level: number } | null = null;
    let currentContent: string[] = [];
    let inFrontmatter = false;
    let skipNextParagraph = false;
    let hasNonTableContent = false;

    // Header stack for breadcrumb tracking
    const headerStack: Array<{ text: string; level: number }> = [];

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

            if (clozeEnabled) {
              const expanded = FlashcardParser.expandClozes(
                cells[0], cells[1], rowNotes, "table", breadcrumb
              );
              flashcards.push(...expanded);
            } else {
              flashcards.push({
                front: cells[0],
                back: cells[1],
                notes: rowNotes,
                type: "table",
                breadcrumb,
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
          const headerText = line.replace(/^#{1,6}\s+/, "");

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
            headerStack.push({ text: headerText, level: currentHeaderLevel });
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
          // Push current header onto stack
          headerStack.push({ text: headerText, level: currentHeaderLevel });

          // Start new header
          currentHeader = {
            text: line,
            level: currentHeaderLevel,
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
   * Helper to finalize current header flashcard
   */
  private static finalizeCurrentHeader(
    currentHeader: { text: string; level: number } | null,
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
      const front = currentHeader.text.replace(/^#{1,6}\s+/, "");
      const back = currentContent.join("\n").trim();

      if (clozeEnabled) {
        const expanded = FlashcardParser.expandClozes(
          front, back, "", "header-paragraph", breadcrumb
        );
        flashcards.push(...expanded);
      } else {
        flashcards.push({
          front,
          back,
          notes: "",
          type: "header-paragraph",
          breadcrumb,
        });
      }
    }
  }
}
