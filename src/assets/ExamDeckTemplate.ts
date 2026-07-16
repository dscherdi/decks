import { I18n } from "@decks/core";

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

---

## ${t.section1}

${t.section1Body}

## ${t.mcq1Front}

- [ ] ${t.mcq1OptA}
- [x] ${t.mcq1OptB}
- [ ] ${t.mcq1OptC}
- [ ] ${t.mcq1OptD}

%%${t.mcq1Note}%%

---

## ${t.section2}

${t.section2Body}

## ${t.mcq2Front}

- [x] ${t.mcq2OptA}
- [ ] ${t.mcq2OptB}
- [x] ${t.mcq2OptC}
- [x] ${t.mcq2OptD}

---

## ${t.section3}

${t.section3Body}

## ${t.tfFront}

- [x] ${t.tfTrue}
- [ ] ${t.tfFalse}

---

## ${t.section4}

${t.section4Body}

## ${t.saFront}

${t.saBack}

---

${t.outro}
`;
}
