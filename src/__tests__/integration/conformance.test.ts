jest.unmock("sql.js");

import { describeRenameDetection } from "@decks/conformance/rename";
import { describeSyncUpsert } from "@decks/conformance/sync-upsert";
import { describeSuspendDurability } from "@decks/conformance/suspend-durability";
import { describeAnchorInterop } from "@decks/conformance/anchor-interop";
import type { ConformanceHost } from "@decks/conformance/harness";
import { setupTestDatabase, teardownTestDatabase } from "./database-test-utils";

/** The plugin's side of the shared suites; the app runs the same ones. */
const host: ConformanceHost = {
  label: "obsidian plugin",
  open: async () => await setupTestDatabase(),
  close: async () => {
    await teardownTestDatabase();
  },
};

describeRenameDetection(host);
describeSyncUpsert(host);
describeSuspendDurability(host);
describeAnchorInterop(host);
