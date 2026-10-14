import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setupEnv } from "./helpers.js";

const tmp = setupEnv();
const { manager, Connection } = await import("../core/db/index.js");
const { Blueprint } = await import("../core/db/schema.js");
const { toPgSql } = await import("../core/db/drivers/postgres.js");
const { Model } = await import("../core/model.js");
const { Migrator } = await import("../core/migrator.js");
after(async () => {
  await manager.closeAll();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("named connections are independent", async () => {
  assert.deepEqual(manager.names().sort(), ["analytics", "default"]);
  const a = manager.connection("analytics"),
    d = manager.connection("default");
  await a.schema.createTable("events", (t) => {
    t.id();
    t.string("name", 50).notNull();
    t.integer("n").notNull().default(0);
    t.timestamps();
  });
  assert.ok((await a.tables()).includes("events"));
  assert.ok(!(await d.tables()).includes("events"));
  assert.throws(
    () => manager.connection("missing"),
    /Unknown database connection/,
  );
});

test("Model on a non-default connection: CRUD, pagination, mass-assignment, identifier safety", async () => {
  class Event extends Model {
    static table = "events";
    static connection = "analytics";
    static fillable = ["name", "n"];
  }
  const e = await Event.create({ name: "signup", n: 1, id: 999, evil: "x" });
  assert.notEqual(e.id, 999);
  await Event.create({ name: "login", n: 2 });
  assert.equal((await Event.update(e.id, { n: 5 })).n, 5);
  const page = await Event.paginate(1, 1, {}, { orderBy: "id", order: "ASC" });
  assert.equal(page.total, 2);
  assert.equal(page.pages, 2);
  assert.equal(page.data[0].name, "signup");
  assert.equal(
    (await Event.all({ name: ["signup'; DROP TABLE events;--", "login"] }))
      .length,
    1,
  );
  await assert.rejects(
    () => Event.all({ "name; DROP TABLE events": 1 }),
    /Invalid SQL identifier/,
  );
  assert.equal(await Event.delete(e.id), true);
  assert.equal(await Event.count(), 1);
});

test("transactions roll back; concurrent transactions are serialised (no interleaving)", async () => {
  const a = manager.connection("analytics");
  await assert.rejects(
    () =>
      a.transaction(async (tx) => {
        await tx.run(
          "INSERT INTO events (name, n, created_at, updated_at) VALUES (?,?,?,?)",
          ["rb", 1, "x", "x"],
        );
        throw new Error("boom");
      }),
    /boom/,
  );
  assert.equal(
    Number(
      (await a.get("SELECT COUNT(*) AS c FROM events WHERE name = 'rb'")).c,
    ),
    0,
  );
  await Promise.all(
    [1, 2, 3].map((i) =>
      a.transaction(async (tx) => {
        await tx.run(
          "INSERT INTO events (name, n, created_at, updated_at) VALUES (?,?,?,?)",
          ["tx" + i, i, "x", "x"],
        );
        await new Promise((r) => setTimeout(r, 5));
        await tx.run("UPDATE events SET n = n + 10 WHERE name = ?", ["tx" + i]);
      }),
    ),
  );
  assert.deepEqual(
    (await a.all("SELECT n FROM events WHERE name LIKE 'tx%' ORDER BY n")).map(
      (r) => r.n,
    ),
    [11, 12, 13],
  );
});

test("upsert and columns()/tables() introspection", async () => {
  const a = manager.connection("analytics");
  await a.schema.createTable("kv", (t) => {
    t.string("k", 40).primary();
    t.text("v").notNull();
  });
  await a.upsert("kv", { k: "a", v: "1" }, ["k"]);
  await a.upsert("kv", { k: "a", v: "2" }, ["k"]);
  assert.equal((await a.all("SELECT * FROM kv")).length, 1);
  assert.equal((await a.get("SELECT v FROM kv WHERE k = ?", ["a"])).v, "2");
  const cols = await a.columns("kv");
  assert.deepEqual(
    cols.map((c) => [c.name, c.pk]),
    [
      ["k", true],
      ["v", false],
    ],
  );
  await assert.rejects(() => a.columns("kv; DROP"), /Invalid SQL identifier/);
});

test("migrator runs portable migrations per connection and rolls back", async () => {
  const dir = path.join(tmp, "mig");
  fs.mkdirSync(dir);
  fs.writeFileSync(
    path.join(dir, "20260101000000_create_widgets_table.js"),
    "export async function up(db){ await db.schema.createTable('widgets',(t)=>{t.id();t.string('title',80).notNull();t.timestamps();t.index('title');}); }\nexport async function down(db){ await db.schema.dropTable('widgets'); }\n",
  );
  const m = new Migrator(manager.connection("analytics"), dir);
  assert.equal((await m.migrate()).length, 1);
  assert.equal((await m.migrate()).length, 0);
  assert.ok(
    (await manager.connection("analytics").tables()).includes("widgets"),
  );
  assert.deepEqual(await m.rollback(), [
    "20260101000000_create_widgets_table.js",
  ]);
  assert.ok(
    !(await manager.connection("analytics").tables()).includes("widgets"),
  );
});

test("schema builder emits correct DDL per dialect", () => {
  const build = (dialect) => {
    const t = new Blueprint(new Connection("x", dialect, {}), "users");
    t.id();
    t.string("email", 190).notNull().unique();
    t.bigInteger("team_id");
    t.text("bio");
    t.foreign("team_id", "teams");
    t.timestamps();
    t.index("email");
    return t.createSql().join(";\n");
  };
  const pg = build("postgres"),
    my = build("mysql"),
    lite = build("sqlite");
  assert.match(pg, /"id" BIGSERIAL PRIMARY KEY/);
  assert.match(pg, /VARCHAR\(190\) NOT NULL UNIQUE/);
  assert.match(pg, /"team_id" BIGINT/);
  assert.match(my, /`id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY/);
  assert.match(my, /LONGTEXT/);
  assert.match(my, /ENGINE=InnoDB DEFAULT CHARSET=utf8mb4/);
  assert.match(lite, /"id" INTEGER PRIMARY KEY AUTOINCREMENT/);
  assert.match(lite, /FOREIGN KEY \("team_id"\) REFERENCES "teams"/);
});

test("placeholder translation for PostgreSQL ignores quoted question marks", () => {
  assert.equal(
    toPgSql(`SELECT * FROM t WHERE a = ? AND b = '?' AND "c?" = ? LIMIT ?`),
    `SELECT * FROM t WHERE a = $1 AND b = '?' AND "c?" = $2 LIMIT $3`,
  );
});

// Optional integration tests against REAL servers: TEST_PG_URL=postgres://... TEST_MYSQL_URL=mysql://...
for (const [label, env] of [
  ["postgres", "TEST_PG_URL"],
  ["mysql", "TEST_MYSQL_URL"],
]) {
  test(
    `live ${label} server: DDL, CRUD, upsert, transaction, introspection`,
    { skip: !process.env[env] && `set ${env} to run` },
    async () => {
      const { DatabaseManager } = await import("../core/db/index.js");
      const m = new DatabaseManager({ default: process.env[env] });
      const c = m.connection();
      try {
        await c.schema.dropTable("power_it");
        await c.schema.createTable("power_it", (t) => {
          t.id();
          t.string("name", 60).notNull().unique();
          t.integer("n").notNull().default(0);
          t.text("bio");
        });
        const id = await c.insert("power_it", { name: "ä€😀", n: 3 });
        assert.ok(id > 0);
        assert.deepEqual(
          await c.get("SELECT name, n FROM power_it WHERE id = ?", [id]),
          { name: "ä€😀", n: 3 },
        );
        await c.upsert("power_it", { name: "ä€😀", n: 9 }, ["name"], ["n"]);
        assert.equal(
          (await c.get("SELECT n FROM power_it WHERE name = ?", ["ä€😀"])).n,
          9,
        );
        assert.equal((await c.get("SELECT COUNT(*) AS c FROM power_it")).c, 1);
        await assert.rejects(
          () =>
            c.transaction(async (tx) => {
              await tx.run("DELETE FROM power_it");
              throw new Error("rollback");
            }),
          /rollback/,
        );
        assert.equal(
          Number((await c.get("SELECT COUNT(*) AS c FROM power_it")).c),
          1,
        );
        assert.ok((await c.tables()).includes("power_it"));
        assert.equal(
          (await c.columns("power_it")).find((x) => x.pk).name,
          "id",
        );
        assert.equal(
          (await c.get("SELECT ? AS s", ["'; DROP TABLE power_it; --"])).s,
          "'; DROP TABLE power_it; --",
        );
      } finally {
        await c.schema.dropTable("power_it").catch(() => {});
        await m.closeAll();
      }
    },
  );
}
