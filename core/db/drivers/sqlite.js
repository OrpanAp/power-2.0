import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** SQLite via node:sqlite. One connection; an async mutex serialises statements so transactions never interleave. */
export function createSqliteDriver({ file }) {
  let db = null,
    closed = false,
    chain = Promise.resolve();
  const cache = new Map();

  const open = () => {
    if (closed) throw new Error("Database connection is closed");
    if (!db) {
      if (file !== ":memory:")
        fs.mkdirSync(path.dirname(file), { recursive: true });
      db = new DatabaseSync(file);
      db.exec(
        "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL; PRAGMA trusted_schema = OFF;",
      );
    }
    return db;
  };
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) {
      s = open().prepare(sql);
      if (cache.size > 300) cache.clear();
      cache.set(sql, s);
    }
    return s;
  };
  const raw = (sql, params) => {
    const s = stmt(sql);
    if (/^\s*(select|pragma|with)\b/i.test(sql) || /\breturning\b/i.test(sql))
      return {
        rows: s.all(...params).map((r) => ({ ...r })),
        changes: 0,
        lastId: null,
      };
    const r = s.run(...params);
    return {
      rows: [],
      changes: Number(r.changes),
      lastId: Number(r.lastInsertRowid),
    };
  };
  const lock = (fn) => {
    const p = chain.then(fn);
    chain = p.catch(() => {});
    return p;
  };
  const handle = {
    query: async (sql, params = []) => raw(sql, params),
    exec: async (sql) => {
      open().exec(sql);
    },
  };

  return {
    dialect: "sqlite",
    query: (sql, params = []) => lock(async () => raw(sql, params)),
    exec: (sql) =>
      lock(async () => {
        open().exec(sql);
      }),
    /** Do not call the global connection from inside fn (it would wait on this lock) — use the tx you are given. */
    transaction: (fn) =>
      lock(async () => {
        open().exec("BEGIN IMMEDIATE");
        try {
          const r = await fn(handle);
          open().exec("COMMIT");
          return r;
        } catch (e) {
          try {
            open().exec("ROLLBACK");
          } catch {
            /* already rolled back */
          }
          throw e;
        }
      }),
    info: () => {
      let size = null;
      try {
        size =
          fs.statSync(file).size +
          (fs.existsSync(file + "-wal") ? fs.statSync(file + "-wal").size : 0);
      } catch {
        /* memory */
      }
      return {
        driver: "sqlite",
        target: file === ":memory:" ? ":memory:" : path.basename(file),
        sizeBytes: size,
      };
    },
    close: async () => {
      await chain;
      closed = true;
      cache.clear();
      if (db) {
        db.close();
        db = null;
      }
    },
  };
}
