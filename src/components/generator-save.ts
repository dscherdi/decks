import type { SaveFormat } from "../services/FlashcardComposer";

/** A profile choice shown in the generator's save panel. */
export interface ProfileOpt {
  id: string;
  name: string;
}

/** What the generator modal emits when the user saves the kept cards. */
export type GeneratorSaveRequest =
  | {
      kind: "new-file";
      format: SaveFormat;
      folder: string;
      name: string;
      tag: string;
      profileId: string;
    }
  | { kind: "append"; format: SaveFormat; filePath: string };
