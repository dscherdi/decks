export interface ParsedFlashcard {
  front: string;
  back: string;
  type: "header-paragraph" | "table";
  breadcrumb: string;
}

/**
 * FlashcardParser - Consolidated parsing logic for flashcards from markdown content
 * Supports both table-based and header-paragraph flashcards with configurable header levels
 */
export class FlashcardParser {
  // Pre-compiled regex patterns for better performance
  private static readonly HEADER_REGEX = /^(#{1,6})\s+/;
  private static readonly TABLE_ROW_REGEX = /^\|.*\|$/;
  private static readonly TABLE_SEPARATOR_REGEX = /^\|[\s-]+\|[\s-]+\|$/;

  /**
   * Parse flashcards from content string (optimized single-pass parsing)
   * @param content - Markdown content to parse
   * @param headerLevel - Target header level for header-paragraph flashcards (1-6, default: 2)
   * @returns Array of parsed flashcards
   */
  static parseFlashcardsFromContent(
    content: string,
    headerLevel = 2
  ): ParsedFlashcard[] {
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
            flashcards.push({
              front: cells[0],
              back: cells[1],
              type: "table",
              breadcrumb,
            });
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
              breadcrumb
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
            breadcrumb
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
      finalBreadcrumb
    );

    return flashcards;
  }

  /**
   * Helper to finalize current header flashcard
   * @param currentHeader - Current header being processed
   * @param currentContent - Content lines for the header
   * @param flashcards - Array to add completed flashcard to
   * @param targetHeaderLevel - Target header level to match
   * @param breadcrumb - Header hierarchy breadcrumb
   */
  private static finalizeCurrentHeader(
    currentHeader: { text: string; level: number } | null,
    currentContent: string[],
    flashcards: ParsedFlashcard[],
    targetHeaderLevel: number,
    breadcrumb: string
  ): void {
    if (
      currentHeader &&
      currentContent.length > 0 &&
      currentHeader.level === targetHeaderLevel
    ) {
      flashcards.push({
        front: currentHeader.text.replace(/^#{1,6}\s+/, ""),
        back: currentContent.join("\n").trim(),
        type: "header-paragraph",
        breadcrumb,
      });
    }
  }
}
