export interface ParsedFlashcard {
  front: string;
  back: string;
  type: "header-paragraph" | "table";
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
    headerLevel: number = 2,
  ): ParsedFlashcard[] {
    const lines = content.split("\n");
    const flashcards: ParsedFlashcard[] = [];

    // Single pass through lines for both table and header parsing
    let inTable = false;
    let headerSeen = false;
    let currentHeader: { text: string; level: number } | null = null;
    let currentContent: string[] = [];
    let inFrontmatter = false;
    let skipNextParagraph = false;

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
        if (!inTable) {
          inTable = true;
          headerSeen = false;
        }

        // Skip header and separator rows
        if (!headerSeen) {
          headerSeen = true;
          continue;
        }
        if (FlashcardParser.TABLE_SEPARATOR_REGEX.test(trimmedLine)) {
          continue;
        }

        // Parse table row
        const cells = trimmedLine
          .slice(1, -1) // Remove leading/trailing pipes
          .split("|")
          .map((cell) => cell.trim());

        if (cells.length >= 2 && cells[0] && cells[1]) {
          flashcards.push({
            front: cells[0],
            back: cells[1],
            type: "table",
          });
        }
      } else {
        // Not a table row, end table processing
        if (inTable) {
          inTable = false;
        }

        // Check for headers
        const headerMatch = FlashcardParser.HEADER_REGEX.exec(line);
        if (headerMatch) {
          const currentHeaderLevel = headerMatch[1].length;

          // Check for title headers to skip
          if (line.match(/^#\s+/) && line.toLowerCase().includes("flashcard")) {
            skipNextParagraph = true;
            FlashcardParser.finalizeCurrentHeader(
              currentHeader,
              currentContent,
              flashcards,
              headerLevel,
            );
            currentHeader = null;
            currentContent = [];
            continue;
          }

          // Finalize previous header
          FlashcardParser.finalizeCurrentHeader(
            currentHeader,
            currentContent,
            flashcards,
            headerLevel,
          );

          // Start new header
          currentHeader = {
            text: line,
            level: currentHeaderLevel,
          };
          currentContent = [];
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
          currentContent.push(line);
        }
      }
    }

    // Finalize last header
    FlashcardParser.finalizeCurrentHeader(
      currentHeader,
      currentContent,
      flashcards,
      headerLevel,
    );

    return flashcards;
  }

  /**
   * Helper to finalize current header flashcard
   * @param currentHeader - Current header being processed
   * @param currentContent - Content lines for the header
   * @param flashcards - Array to add completed flashcard to
   * @param targetHeaderLevel - Target header level to match
   */
  private static finalizeCurrentHeader(
    currentHeader: { text: string; level: number } | null,
    currentContent: string[],
    flashcards: ParsedFlashcard[],
    targetHeaderLevel: number,
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
      });
    }
  }
}
