/** Dialect-aware schema builder so migrations run unchanged on SQLite, PostgreSQL and MySQL/MariaDB. */
const TYPES = {
  sqlite: {
    string: () => "TEXT",
    text: "TEXT",
    integer: "INTEGER",
    bigInteger: "INTEGER",
    id: "INTEGER PRIMARY KEY AUTOINCREMENT",
  },
  postgres: {
    string: (n) => `VARCHAR(${n})`,
    text: "TEXT",
    integer: "INTEGER",
    bigInteger: "BIGINT",
    id: "BIGSERIAL PRIMARY KEY",
  },
  mysql: {
    string: (n) => `VARCHAR(${n})`,
    text: "LONGTEXT",
    integer: "INT",
    bigInteger: "BIGINT",
    id: "BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY",
  },
};
const lit = (v) =>
  v === null
    ? "NULL"
    : typeof v === "number"
      ? String(v)
      : `'${String(v).replace(/'/g, "''")}'`;

class Column {
  constructor(name, kind, len) {
    this.name = name;
    this.kind = kind;
    this.len = len;
    this.opts = {};
  }
  notNull() {
    this.opts.notNull = true;
    return this;
  }
  nullable() {
    this.opts.notNull = false;
    return this;
  }
  default(v) {
    this.opts.default = v;
    return this;
  }
  unique() {
    this.opts.unique = true;
    return this;
  }
  primary() {
    this.opts.primary = true;
    return this;
  }
  check(expr) {
    this.opts.check = expr;
    return this;
  }
  index() {
    this.opts.index = true;
    return this;
  }
}

export class Blueprint {
  constructor(conn, table) {
    this.conn = conn;
    this.table = table;
    this.columns = [];
    this.fks = [];
    this.indexes = [];
  }
  _add(name, kind, len) {
    const c = new Column(name, kind, len);
    this.columns.push(c);
    return c;
  }
  id(name = "id") {
    return this._add(name, "id");
  }
  string(name, len = 255) {
    return this._add(name, "string", len);
  }
  text(name) {
    return this._add(name, "text");
  }
  integer(name) {
    return this._add(name, "integer");
  }
  bigInteger(name) {
    return this._add(name, "bigInteger");
  }
  timestamps() {
    this.string("created_at", 40).notNull();
    this.string("updated_at", 40).notNull();
  }
  foreign(col, refTable, refCol = "id", onDelete = "CASCADE") {
    this.fks.push({ col, refTable, refCol, onDelete });
  }
  index(cols, name) {
    this.indexes.push({ cols: [].concat(cols), name, unique: false });
  }
  unique(cols, name) {
    this.indexes.push({ cols: [].concat(cols), name, unique: true });
  }

  _colSql(c) {
    const d = this.conn.dialect,
      q = (n) => this.conn.q(n),
      t = TYPES[d];
    const type = c.kind === "string" ? t.string(c.len) : t[c.kind];
    let sql = `${q(c.name)} ${type}`;
    if (c.kind === "id") return sql;
    if (c.opts.primary) sql += " PRIMARY KEY";
    if (c.opts.notNull) sql += " NOT NULL";
    if ("default" in c.opts) sql += ` DEFAULT ${lit(c.opts.default)}`;
    if (c.opts.unique) sql += " UNIQUE";
    if (c.opts.check) sql += ` CHECK (${c.opts.check})`;
    return sql;
  }
  _indexSql(table) {
    const q = (n) => this.conn.q(n);
    const all = [
      ...this.indexes,
      ...this.columns
        .filter((c) => c.opts.index)
        .map((c) => ({ cols: [c.name], unique: false })),
    ];
    return all.map(
      (i) =>
        `CREATE ${i.unique ? "UNIQUE " : ""}INDEX ${q(i.name || `${i.unique ? "uq" : "idx"}_${table}_${i.cols.join("_")}`)} ON ${q(table)} (${i.cols.map(q).join(", ")})`,
    );
  }
  createSql(ifNotExists = false) {
    const q = (n) => this.conn.q(n);
    const lines = [
      ...this.columns.map((c) => this._colSql(c)),
      ...this.fks.map(
        (f) =>
          `FOREIGN KEY (${q(f.col)}) REFERENCES ${q(f.refTable)} (${q(f.refCol)}) ON DELETE ${f.onDelete}`,
      ),
    ];
    const tail =
      this.conn.dialect === "mysql"
        ? " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
        : "";
    return [
      `CREATE TABLE ${ifNotExists ? "IF NOT EXISTS " : ""}${q(this.table)} (\n  ${lines.join(",\n  ")}\n)${tail}`,
      ...this._indexSql(this.table),
    ];
  }
  alterSql() {
    return [
      ...this.columns.map(
        (c) =>
          `ALTER TABLE ${this.conn.q(this.table)} ADD COLUMN ${this._colSql(c)}`,
      ),
      ...this._indexSql(this.table),
    ];
  }
}

export class Schema {
  constructor(conn) {
    this.conn = conn;
  }
  async _run(sqls) {
    for (const s of sqls) await this.conn.exec(s);
  }
  async createTable(name, cb, { ifNotExists = false } = {}) {
    const t = new Blueprint(this.conn, name);
    cb(t);
    await this._run(t.createSql(ifNotExists));
  }
  async alterTable(name, cb) {
    const t = new Blueprint(this.conn, name);
    cb(t);
    await this._run(t.alterSql());
  }
  async dropTable(name) {
    await this.conn.exec(`DROP TABLE IF EXISTS ${this.conn.q(name)}`);
  }
  async hasTable(name) {
    return (await this.conn.tables()).includes(name);
  }
}
