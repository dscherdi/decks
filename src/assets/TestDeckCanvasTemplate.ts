import { I18n } from "@/i18n/I18n";

/**
 * Build the JSON payload for the canvas getting-started deck.
 *
 * Four text nodes laid out in a 2x2 grid. The intro node uses an h1 so it
 * sits ABOVE the configured header level (default 2) and doesn't accidentally
 * parse as a card. The three card nodes (header-paragraph, table, cloze)
 * each use ## headings so they extract cleanly through FlashcardParser.
 *
 * Node ids are stable, descriptive strings so the synchronizer's per-node
 * card-id hashing stays deterministic across re-syncs and devices.
 */
export function getTestDeckCanvasContent(deckTag: string): string {
  const t = I18n.t.testDeckCanvas;
  const tagBacktick = `\`${deckTag}\``;

  const introText = `# ${t.title}

${I18n.format(t.intro, { tag: tagBacktick })}

${t.formatsHint}`;

  const headerParagraphText = `# ${t.section1}

## ${t.q1}

${t.a1}

## ${t.q2}

${t.a2}`;

  const tableText = `# ${t.section2}

## ${t.fsrsConceptsHeading}

| ${t.colFront} | ${t.colBack} | ${t.colNotes} |
| --- | --- | --- |
| ${t.row1Front} | ${t.row1Back} | ${t.row1Notes} |
| ${t.row2Front} | ${t.row2Back} | ${t.row2Notes} |`;

  const clozeText = `# ${t.section3}

## ${t.solarHeading}

${t.solarBody}`;

  const canvas = {
    nodes: [
      {
        id: "intro",
        type: "text",
        text: introText,
        x: -640,
        y: -360,
        width: 560,
        height: 320,
      },
      {
        id: "header-paragraph",
        type: "text",
        text: headerParagraphText,
        x: 40,
        y: -360,
        width: 560,
        height: 320,
      },
      {
        id: "table",
        type: "text",
        text: tableText,
        x: -640,
        y: 40,
        width: 560,
        height: 320,
      },
      {
        id: "cloze",
        type: "text",
        text: clozeText,
        x: 40,
        y: 40,
        width: 560,
        height: 320,
      },
    ],
    edges: [],
  };

  return JSON.stringify(canvas, null, "\t");
}
