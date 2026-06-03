import { I18n, type RefactorCardType, type RefactorFieldSet } from "@decks/core";

/** A displayable field of a card, keyed by its RefactorFieldSet key. */
export interface CardFieldDef {
  label: string;
  refKey: string;
  isFront?: boolean;
}

/** The display fields (label + key + front flag) for a card type. */
export function cardFieldDefs(type: RefactorCardType): CardFieldDef[] {
  const ef = I18n.t.modals.editFlashcard;
  switch (type) {
    case "header-paragraph":
      return [
        { label: ef.fieldHeader, refKey: "front", isFront: true },
        { label: ef.fieldBody, refKey: "back" },
      ];
    case "table":
      return [
        { label: ef.fieldFront, refKey: "front", isFront: true },
        { label: ef.fieldBack, refKey: "back" },
        { label: ef.fieldNotes, refKey: "notes" },
      ];
    case "cloze":
      return [
        { label: ef.fieldHeader, refKey: "front", isFront: true },
        { label: ef.fieldBody, refKey: "sentence" },
      ];
    case "spatial":
      return [
        { label: ef.fieldFront, refKey: "front", isFront: true },
        { label: ef.fieldBack, refKey: "back" },
        { label: ef.fieldHint, refKey: "hint" },
      ];
    case "image-occlusion":
      return [{ label: ef.fieldBody, refKey: "listItem" }];
  }
}

/** Read a field value from a RefactorFieldSet by its key, type-safely. */
export function fieldSetValue(fs: RefactorFieldSet, refKey: string): string {
  switch (fs.type) {
    case "header-paragraph":
      return refKey === "front" ? fs.front : refKey === "back" ? fs.back : "";
    case "table":
      return refKey === "front"
        ? fs.front
        : refKey === "back"
          ? fs.back
          : refKey === "notes"
            ? fs.notes
            : "";
    case "cloze":
      return refKey === "front" ? fs.front : refKey === "sentence" ? fs.sentence : "";
    case "spatial":
      return refKey === "front"
        ? fs.front
        : refKey === "back"
          ? fs.back
          : refKey === "hint"
            ? fs.hint
            : "";
    case "image-occlusion":
      return refKey === "listItem" ? fs.listItem : "";
  }
}
