import { I18n } from "@decks/core";

/**
 * Build the JSON payload for the canvas getting-started deck.
 *
 * Layout:
 *   - 2x2 grid of text nodes demonstrating each standalone parsing format
 *     (header-paragraph, table, cloze) plus an intro node.
 *   - A small connected subgraph below it demonstrates **spatial cards**:
 *     three text nodes wired by two labelled edges. Each edge becomes a
 *     spatial card (front = from-node text, back = to-node text, hint = edge
 *     label).
 *
 * Node ids are stable, descriptive strings so the synchronizer's per-edge
 * and per-node card-id hashing stays deterministic across re-syncs and devices.
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
      // Spatial subgraph: 1 intro node + 3 connected nodes wired into a tiny
      // graph. The h1 intro keeps itself out of the parser (the four-format
      // path needs an h2 to start a card); the connected nodes don't go
      // through that path at all because they're spatial endpoints.
      {
        id: "spatial-intro",
        type: "text",
        text: t.spatialIntro,
        x: -640,
        y: 440,
        width: 560,
        height: 200,
      },
      {
        id: "spatial-photosynthesis",
        type: "text",
        text: t.spatialNodePhotosynthesis,
        x: 40,
        y: 440,
        width: 200,
        height: 80,
      },
      {
        id: "spatial-sunlight",
        type: "text",
        text: t.spatialNodeSunlight,
        x: 320,
        y: 380,
        width: 200,
        height: 80,
      },
      {
        id: "spatial-glucose",
        type: "text",
        text: t.spatialNodeGlucose,
        x: 320,
        y: 540,
        width: 200,
        height: 80,
      },
    ],
    edges: [
      {
        id: "edge-spatial-needs",
        fromNode: "spatial-photosynthesis",
        fromSide: "right",
        toNode: "spatial-sunlight",
        toSide: "left",
        label: t.spatialEdgeNeeds,
      },
      {
        id: "edge-spatial-produces",
        fromNode: "spatial-photosynthesis",
        fromSide: "right",
        toNode: "spatial-glucose",
        toSide: "left",
        label: t.spatialEdgeProduces,
      },
    ],
  };

  return JSON.stringify(canvas, null, "\t");
}
