jest.unmock("sql.js");

import initSqlJs from "sql.js";
import { CREATE_TABLES_SQL, buildMigrationSQL } from "@decks/core";

describe("profile_tag_mappings migration", () => {
  it("preserves tombstones through the table rebuild (deleted mappings must not resurrect)", async () => {
    const SQL = await initSqlJs({
      locateFile: (file: string) => `node_modules/sql.js/dist/${file}`,
    });
    const db = new SQL.Database();
    db.run(CREATE_TABLES_SQL);
    db.run(`
      INSERT INTO profile_tag_mappings (id, profile_id, tag, created, deleted_at)
      VALUES ('map_live', 'profile_x', '#flashcards', '2026-01-02T00:00:00Z', NULL);
      INSERT INTO profile_tag_mappings (id, profile_id, tag, created, deleted_at)
      VALUES ('map_dead', 'profile_h6', '#flashcards/test', '2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z');
    `);

    db.run(buildMigrationSQL(db));

    const live = db.exec(
      "SELECT id, profile_id FROM profile_tag_mappings WHERE deleted_at IS NULL"
    );
    expect(live[0]?.values).toEqual([["map_live", "profile_x"]]);

    const dead = db.exec(
      "SELECT deleted_at FROM profile_tag_mappings WHERE id = 'map_dead'"
    );
    expect(dead[0]?.values[0]?.[0]).toBe("2026-01-03T00:00:00Z");
    db.close();
  });

  it("defaults deleted_at to NULL when migrating a pre-tombstone table", async () => {
    const SQL = await initSqlJs({
      locateFile: (file: string) => `node_modules/sql.js/dist/${file}`,
    });
    const db = new SQL.Database();
    // Ancient shape: no deleted_at column, no UNIQUE(tag), duplicate tags.
    db.run(`
      CREATE TABLE profile_tag_mappings (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        created TEXT NOT NULL
      );
      INSERT INTO profile_tag_mappings VALUES ('map_old', 'profile_h6', '#flashcards', '2026-01-01T00:00:00Z');
      INSERT INTO profile_tag_mappings VALUES ('map_new', 'profile_x', '#flashcards', '2026-01-02T00:00:00Z');
    `);

    db.run(buildMigrationSQL(db));

    // Newest row wins the UNIQUE(tag) dedupe; deleted_at defaults NULL.
    const rows = db.exec(
      "SELECT id, profile_id, deleted_at FROM profile_tag_mappings WHERE tag = '#flashcards'"
    );
    expect(rows[0]?.values).toEqual([["map_new", "profile_x", null]]);
    db.close();
  });
});
