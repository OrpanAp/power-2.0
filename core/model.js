import { manager } from "./db/index.js";

const now = () => new Date().toISOString();

/** Async active-record base model. Set `static connection = 'name'` to use a non-default database. */
export class Model {
  static table = "";
  static primaryKey = "id";
  static connection = "default";
  static fillable = []; // mass-assignment whitelist (empty = allow all)
  static hidden = []; // stripped by serialize()
  static timestamps = true;

  static get db() {
    return manager.connection(this.connection);
  }
  static _pick(data) {
    const out = {};
    for (const [k, v] of Object.entries(data || {})) {
      if (this.fillable.length && !this.fillable.includes(k)) continue;
      out[k] = v;
    }
    return out;
  }
  static _where(where = {}) {
    const q = (c) => this.db.q(c),
      parts = [],
      params = [];
    for (const [k, v] of Object.entries(where)) {
      if (v === null) parts.push(`${q(k)} IS NULL`);
      else if (Array.isArray(v)) {
        if (!v.length) {
          parts.push("0 = 1");
          continue;
        }
        parts.push(`${q(k)} IN (${v.map(() => "?").join(",")})`);
        params.push(...v);
      } else {
        parts.push(`${q(k)} = ?`);
        params.push(v);
      }
    }
    return { sql: parts.length ? " WHERE " + parts.join(" AND ") : "", params };
  }
  static async all(where = {}, { orderBy, order = "ASC", limit, offset } = {}) {
    const w = this._where(where);
    let sql = `SELECT * FROM ${this.db.q(this.table)}${w.sql}`;
    if (orderBy)
      sql += ` ORDER BY ${this.db.q(orderBy)} ${String(order).toUpperCase() === "DESC" ? "DESC" : "ASC"}`;
    const params = [...w.params];
    if (limit) {
      sql += " LIMIT ?";
      params.push(Number(limit));
      if (offset) {
        sql += " OFFSET ?";
        params.push(Number(offset));
      }
    }
    return this.db.all(sql, params);
  }
  static async find(id) {
    return this.db.get(
      `SELECT * FROM ${this.db.q(this.table)} WHERE ${this.db.q(this.primaryKey)} = ?`,
      [id],
    );
  }
  static async first(where = {}) {
    return (await this.all(where, { limit: 1 }))[0] || null;
  }
  static async count(where = {}) {
    const w = this._where(where);
    return Number(
      (
        await this.db.get(
          `SELECT COUNT(*) AS c FROM ${this.db.q(this.table)}${w.sql}`,
          w.params,
        )
      ).c,
    );
  }
  static async paginate(
    page = 1,
    perPage = 15,
    where = {},
    { orderBy = this.primaryKey, order = "DESC" } = {},
  ) {
    page = Math.max(1, parseInt(page) || 1);
    perPage = Math.min(100, Math.max(1, parseInt(perPage) || 15));
    const total = await this.count(where);
    const data = await this.all(where, {
      orderBy,
      order,
      limit: perPage,
      offset: (page - 1) * perPage,
    });
    return {
      data,
      total,
      page,
      perPage,
      pages: Math.max(1, Math.ceil(total / perPage)),
    };
  }
  static async create(data) {
    const row = this._pick(data);
    if (this.timestamps) {
      row.created_at = now();
      row.updated_at = row.created_at;
    }
    const id = await this.db.insert(this.table, row, this.primaryKey);
    return this.find(id);
  }
  static async update(id, data) {
    const row = this._pick(data);
    if (this.timestamps) row.updated_at = now();
    const cols = Object.keys(row);
    if (!cols.length) return this.find(id);
    await this.db.run(
      `UPDATE ${this.db.q(this.table)} SET ${cols.map((c) => `${this.db.q(c)} = ?`).join(", ")} WHERE ${this.db.q(this.primaryKey)} = ?`,
      [...Object.values(row), id],
    );
    return this.find(id);
  }
  static async delete(id) {
    return (
      (
        await this.db.run(
          `DELETE FROM ${this.db.q(this.table)} WHERE ${this.db.q(this.primaryKey)} = ?`,
          [id],
        )
      ).changes > 0
    );
  }
  static serialize(row) {
    if (!row) return row;
    const o = { ...row };
    for (const h of this.hidden) delete o[h];
    return o;
  }
}
