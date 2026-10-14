import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Migration files: <sortable-name>.js exporting async up(db) / down(db) — `db` is the transaction-bound connection; use db.schema.*  */
export class Migrator {
  constructor(conn, dir) {
    this.db = conn;
    this.dir = dir;
  }

  async _ensure() {
    await this.db.schema.createTable(
      "migrations",
      (t) => {
        t.id();
        t.string("name", 190).notNull().unique();
        t.integer("batch").notNull();
        t.string("run_at", 40).notNull();
      },
      { ifNotExists: true },
    );
  }
  _files() {
    return fs.existsSync(this.dir)
      ? fs
          .readdirSync(this.dir)
          .filter((f) => f.endsWith(".js"))
          .sort()
      : [];
  }
  _load(file) {
    return import(pathToFileURL(path.join(this.dir, file)).href);
  }

  async status() {
    await this._ensure();
    const done = new Map(
      (await this.db.all("SELECT name, batch FROM migrations")).map((r) => [
        r.name,
        r.batch,
      ]),
    );
    return this._files().map((f) => ({
      name: f,
      ran: done.has(f),
      batch: done.get(f) ?? null,
    }));
  }
  async migrate() {
    const pending = (await this.status()).filter((m) => !m.ran);
    if (!pending.length) return [];
    const batch =
      Number(
        (await this.db.get("SELECT MAX(batch) AS b FROM migrations")).b || 0,
      ) + 1;
    for (const m of pending) {
      const mod = await this._load(m.name);
      // Note: MySQL commits DDL implicitly, so a failed MySQL migration cannot be fully rolled back.
      await this.db.transaction(async (tx) => {
        await mod.up(tx);
        await tx.run(
          "INSERT INTO migrations (name, batch, run_at) VALUES (?, ?, ?)",
          [m.name, batch, new Date().toISOString()],
        );
      });
    }
    return pending.map((m) => m.name);
  }
  async rollback() {
    await this._ensure();
    const last = (await this.db.get("SELECT MAX(batch) AS b FROM migrations"))
      .b;
    if (!last) return [];
    const rows = await this.db.all(
      "SELECT name FROM migrations WHERE batch = ? ORDER BY id DESC",
      [last],
    );
    for (const { name } of rows) {
      const mod = await this._load(name);
      await this.db.transaction(async (tx) => {
        await mod.down(tx);
        await tx.run("DELETE FROM migrations WHERE name = ?", [name]);
      });
    }
    return rows.map((r) => r.name);
  }
}
