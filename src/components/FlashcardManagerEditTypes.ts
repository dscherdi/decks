import type { FilterDefinition } from "../database/types";

export type EditTarget =
  | { kind: "manual"; id: string; name: string }
  | { kind: "filter"; id: string; name: string; filterDefinition: FilterDefinition };

export type EditCommitPayload =
  | { kind: "manual"; toAdd: string[]; toRemove: string[] }
  | { kind: "filter"; definition: FilterDefinition };
