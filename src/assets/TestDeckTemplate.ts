import { I18n } from "@decks/core";

export function getTestDeckContent(deckTag: string): string {
  const tag = deckTag.replace("#", "");
  const t = I18n.t.testDeck;
  const tagBacktick = `\`${deckTag}\``;

  return `---
tags:
  - ${tag}
---
# ${t.title}

${I18n.format(t.intro, { tag: tagBacktick })}

${t.formatsHint}

---

## ${t.section1}

${t.section1Body}

## ${t.q1}

${t.a1}

## ${t.q2}

${I18n.format(t.a2, { tag: tagBacktick })}

---

## ${t.section2}

${t.section2Body}

## ${t.fsrsConceptsHeading}

| ${t.colFront} | ${t.colBack} | ${t.colNotes} |
| --- | --- | --- |
| ${t.row1Front} | ${t.row1Back} | ${t.row1Notes} |
| ${t.row2Front} | ${t.row2Back} | ${t.row2Notes} |

${t.tableNote}

---

## ${t.section3}

${t.section3Body}

## ${t.solarHeading}

${t.solarBody}

---

## ${t.section4}

${t.section4Body}

## ${t.bonesHeading}

![[arm_bones.png]]

1. ==${t.bone1}==
2. ==${t.bone2}==
3. ==${t.bone3}==

---

## ${t.section5}

${I18n.format(t.section5Body, { tag: t.templateTag })}

## ${t.templatesTableHeading} #${t.templateTag}

| ${t.tplColWord} | ${t.tplColReading} | ${t.tplColMeaning} |
| --- | --- | --- |
| ${t.tplRow1Word} | ${t.tplRow1Reading} | ${t.tplRow1Meaning} |
| ${t.tplRow2Word} | ${t.tplRow2Reading} | ${t.tplRow2Meaning} |

---
`;
}

/**
 * Sample template file for the getting-started "Templates" section. Bound by
 * the `templateTag` to the tagged table heading; uses positional variables
 * ({{1}}/{{2}}/{{3}}) so it works regardless of the localized column headers.
 */
export function getTemplateShowcaseContent(): string {
  const t = I18n.t.testDeck;
  return [
    "---",
    "tags:",
    `  - ${t.templateTag}`,
    "---",
    "",
    "```decks-html-front",
    '<div class="decks-vocab-card">',
    "  <ruby>{{1}}<rt>{{2}}</rt></ruby>",
    "</div>",
    "<style>",
    "  .decks-vocab-card { font-size: 2.6em; text-align: center; padding: 16px; }",
    "  .decks-vocab-card rt { font-size: 0.35em; color: var(--text-muted); }",
    "</style>",
    "```",
    "",
    "```decks-md-back",
    "**{{3}}**",
    "```",
    "",
  ].join("\n");
}
