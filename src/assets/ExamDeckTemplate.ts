import { I18n } from "@decks/core";

// All prose lives under the H1 (never a card); every H2 is a question. No
// scaffolding headings between cards — a heading at the parsed level IS a
// card front, and deeper levels would nest under the preceding question.
export function getExamDeckContent(deckTag: string): string {
  const examTag = `${deckTag.replace("#", "")}/exams`;
  const t = I18n.t.examDeck;
  const tagBacktick = `\`#${examTag}\``;

  return `---
tags:
  - ${examTag}
---
# ${t.title}

${I18n.format(t.intro, { tag: tagBacktick })}

${t.formatsHint}

${t.outro}

## ${t.mcq1Front}

- [ ] ${t.mcq1OptA}
- [x] ${t.mcq1OptB}
- [ ] ${t.mcq1OptC}
- [ ] ${t.mcq1OptD}

%%${t.mcq1Note}%%

## ${t.mcq2Front}

- [x] ${t.mcq2OptA}
- [ ] ${t.mcq2OptB}
- [x] ${t.mcq2OptC}
- [x] ${t.mcq2OptD}

## ${t.tfFront}

- [x] ${t.tfTrue}
- [ ] ${t.tfFalse}

## ${t.saFront}

${t.saBack}

## ${t.tableHeading}

| ${t.tColFront} | ${t.tColBack} | ${t.tColNotes} |
| --- | --- | --- |
| ${t.tRow1Front} | ${t.tRow1Back} | ${t.tRow1Notes} |
| ${t.tRow2Front} | ${t.tRow2Back} | ${t.tRow2Notes} |

## ${t.clozeHeading}

${t.clozeBody}
`;
}
