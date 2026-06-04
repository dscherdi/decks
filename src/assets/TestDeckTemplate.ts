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
`;
}
