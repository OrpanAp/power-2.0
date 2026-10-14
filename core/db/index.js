import fs from "node:fs";
import path from "node:path";
import { config } from "../../config/config.js";
import { Schema } from "./schema.js";
import { createSqliteDriver } from "./drivers/sqlite.js";
import { createPostgresDriver } from "./drivers/postgres.js";
import { createMysqlDriver } from "./drivers/mysql.js";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Validate + quote an SQL identifier. Identifiers are never taken from user input unvalidated; values are always bound parameters. */
export function quoteId(name, dialect = "sqlite") {
  if (!IDENT.test(String(name)))
    throw new Error(`Invalid SQL identifier: ${name}`);
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}
const bind = (params) =>
  params.map((p) =>
    p === undefined ? null : typeof p === "boolean" ? Number(p) : p,
  );

/** Uniform async API over any driver (or a transaction handle). SQL uses `?` placeholders on every dialect. */
export class Connection {
  constructor(name, dialect, executor, factory = null) {
    this.name = name;
    this.dialect = dialect;
    this._ex = executor;
    this._factory = factory;
    this.inTx = false;
    this.schema = new Schema(this);
  }
  get ex() {
    return (this._ex ||= this._factory());
  }
  q(id) {
    return quoteId(id, this.dialect);
  }

  async all(sql, params = []) {
    return (await this.ex.query(sql, bind(params))).rows;
  }
  async get(sql, params = []) {
    return (await this.all(sql, params))[0] || null;
  }
  async run(sql, params = []) {
    const r = await this.ex.query(sql, bind(params));
    return { changes: r.changes, lastId: r.lastId };
  }
  /** DDL / statements without user data. Multi-statement support depends on the driver (SQLite/PostgreSQL yes, MySQL no). */
  async exec(sql) {
    return this.ex.exec(sql);
  }

  async insert(table, row, pk = "id") {
    const cols = Object.keys(row);
    const sql = `INSERT INTO ${this.q(table)} (${cols.map((c) => this.q(c)).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
    if (this.dialect === "postgres") {
      const r = await this.ex.query(
        `${sql} RETURNING ${this.q(pk)}`,
        bind(Object.values(row)),
      );
      return r.rows[0]?.[pk] ?? null;
    }
    return (await this.ex.query(sql, bind(Object.values(row)))).lastId;
  }
  async upsert(table, row, conflict, update) {
    const cols = Object.keys(row),
      upd = update || cols.filter((c) => !conflict.includes(c));
    const base = `INSERT INTO ${this.q(table)} (${cols.map((c) => this.q(c)).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
    const tail =
      this.dialect === "mysql"
        ? ` ON DUPLICATE KEY UPDATE ${upd.map((c) => `${this.q(c)} = VALUES(${this.q(c)})`).join(", ")}`
        : ` ON CONFLICT (${conflict.map((c) => this.q(c)).join(", ")}) DO UPDATE SET ${upd.map((c) => `${this.q(c)} = excluded.${this.q(c)}`).join(", ")}`;
    return this.run(base + tail, Object.values(row));
  }
  async transaction(fn) {
    if (this.inTx) return fn(this);
    return this.ex.transaction((handle) => {
      const tx = new Connection(this.name, this.dialect, handle);
      tx.inTx = true;
      return fn(tx);
    });
  }

  async tables() {
    const sql = {
      sqlite:
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      postgres:
        "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY 1",
      mysql:
        "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY 1",
    }[this.dialect];
    return (await this.all(sql))
      .map((r) => r.name)
      .filter((n) => IDENT.test(n));
  }
  /** Normalised column info: { name, type, notnull, pk, default } */
  async columns(table) {
    this.q(table);
    if (this.dialect === "sqlite") {
      return (await this.all(`PRAGMA table_info(${this.q(table)})`)).map(
        (c) => ({
          name: c.name,
          type: c.type,
          notnull: !!c.notnull,
          pk: c.pk > 0,
          default: c.dflt_value,
        }),
      );
    }
    const sql =
      this.dialect === "postgres"
        ? `SELECT c.column_name AS name, c.data_type AS type, c.is_nullable AS nullable, c.column_default AS dflt,
           EXISTS (SELECT 1 FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage k
                   ON tc.constraint_name = k.constraint_name AND tc.table_schema = k.table_schema
                   WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = c.table_name AND tc.table_schema = c.table_schema AND k.column_name = c.column_name) AS pk
         FROM information_schema.columns c WHERE c.table_schema = current_schema() AND c.table_name = ? ORDER BY c.ordinal_position`
        : `SELECT column_name AS name, column_type AS type, is_nullable AS nullable, column_default AS dflt, (column_key = 'PRI') AS pk
         FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position`;
    return (await this.all(sql, [table])).map((c) => ({
      name: c.name,
      type: String(c.type),
      notnull: c.nullable === "NO",
      pk: c.pk === true || c.pk === 1,
      default: c.dflt,
    }));
  }
  info() {
    return this._ex?.info?.() ?? { driver: this.dialect };
  }
  async ping() {
    try {
      await this.get("SELECT 1 AS ok");
      return true;
    } catch {
      return false;
    }
  }
  async close() {
    await this._ex?.close?.();
    this._ex = null;
  }
}

/** sqlite:./file.db | sqlite::memory: | postgres://u:p@host:5432/db?sslmode=require | mysql://u:p@host:3306/db?ssl=true */
export function parseDbUrl(url, root = config.root) {
  if (/^sqlite:/i.test(url)) {
    const f = url.replace(/^sqlite:(\/\/)?/i, "");
    return {
      dialect: "sqlite",
      file: f === ":memory:" || f === "" ? ":memory:" : path.resolve(root, f),
    };
  }
  const u = new URL(url);
  const scheme = u.protocol.replace(":", "").toLowerCase();
  const dialect = {
    postgres: "postgres",
    postgresql: "postgres",
    mysql: "mysql",
    mariadb: "mysql",
  }[scheme];
  if (!dialect)
    throw new Error(
      `Unsupported database URL scheme "${scheme}" (use sqlite, postgres or mysql)`,
    );
  const mode = (
    u.searchParams.get("sslmode") ||
    (u.searchParams.get("ssl") === "true" ? "require" : "disable")
  ).toLowerCase();
  const caPath = u.searchParams.get("sslca");
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
  if (mode === "disable" && !local && config.isProd)
    console.warn(
      `[db] WARNING: "${u.hostname}" is a remote database without TLS. Add ?sslmode=verify-full`,
    );
  return {
    dialect,
    host: decodeURIComponent(u.hostname) || "localhost",
    port: Number(u.port) || (dialect === "postgres" ? 5432 : 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)),
    ssl:
      mode === "disable"
        ? null
        : {
            verify: ["verify-ca", "verify-full"].includes(mode),
            ca: caPath ? fs.readFileSync(caPath) : undefined,
          },
    poolMax: Number(u.searchParams.get("pool")) || config.dbPoolMax,
    statementTimeout: Number(u.searchParams.get("timeout")) || 30000,
  };
}
function createDriver(o) {
  if (o.dialect === "sqlite") return createSqliteDriver(o);
  return o.dialect === "postgres"
    ? createPostgresDriver(o)
    : createMysqlDriver(o);
}

export class DatabaseManager {
  constructor(urls) {
    this.urls = urls;
    this.conns = new Map();
  }
  names() {
    return Object.keys(this.urls);
  }
  connection(name = "default") {
    name = name || "default";
    let c = this.conns.get(name);
    if (!c) {
      if (!this.urls[name])
        throw new Error(
          `Unknown database connection "${name}". Configured: ${this.names().join(", ")}`,
        );
      const o = parseDbUrl(this.urls[name]);
      c = new Connection(name, o.dialect, null, () => createDriver(o));
      this.conns.set(name, c);
    }
    return c;
  }
  async closeAll() {
    await Promise.all([...this.conns.values()].map((c) => c.close()));
  }
}

export const manager = new DatabaseManager(config.dbUrls);
/** Default connection. */
export const db = manager.connection("default");
