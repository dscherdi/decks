jest.unmock("sql.js");

import initSqlJs from "sql.js";

// sql.js 1.14.1 lost stack on every Database.exec; after about 327,000 calls the worker's database broke for good.
describe("the bundled sql.js", () => {
  it("survives more Database.exec calls than the 1.14.1 stack allowed", async () => {
    const SQL = await initSqlJs({
      locateFile: (file: string) => `node_modules/sql.js/dist/${file}`,
    });
    const db = new SQL.Database();
    db.run("CREATE TABLE t (id TEXT PRIMARY KEY)");
    db.run("INSERT INTO t VALUES ('a')");
    for (let i = 0; i < 350_000; i++) db.exec("SELECT id FROM t WHERE id = ?", ["a"]);
    expect(db.exec("SELECT COUNT(*) FROM t")[0].values[0][0]).toBe(1);
    db.close();
  });
});
