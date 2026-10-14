/** Minimal connection pool shared by the PostgreSQL and MySQL drivers. */
export class Pool {
  constructor(create, { max = 5, beginSql = "BEGIN" } = {}) {
    this.create = create;
    this.max = max;
    this.beginSql = beginSql;
    this.idle = [];
    this.all = new Set();
    this.waiters = [];
    this.closed = false;
  }
  async acquire() {
    if (this.closed) throw new Error("Pool is closed");
    while (this.idle.length) {
      const c = this.idle.pop();
      if (!c.dead) return c;
      this.all.delete(c);
    }
    if (this.all.size < this.max) {
      this.all.add(null);
      try {
        const c = await this.create();
        this.all.delete(null);
        this.all.add(c);
        return c;
      } catch (e) {
        this.all.delete(null);
        throw e;
      }
    }
    return new Promise((resolve, reject) =>
      this.waiters.push({ resolve, reject }),
    );
  }
  release(c) {
    if (c.dead) {
      this.all.delete(c);
      const w = this.waiters.shift();
      if (w) this.acquire().then(w.resolve, w.reject);
      return;
    }
    const w = this.waiters.shift();
    if (w) w.resolve(c);
    else this.idle.push(c);
  }
  async query(sql, params) {
    for (let attempt = 0; ; attempt++) {
      const c = await this.acquire();
      try {
        return await c.query(sql, params);
      } catch (e) {
        if (c.dead && e.connectionLost && attempt === 0) continue;
        throw e;
      } finally {
        // stale idle connection: retry once
        this.release(c);
      }
    }
  }
  async exec(sql) {
    const c = await this.acquire();
    try {
      return await c.exec(sql);
    } finally {
      this.release(c);
    }
  }
  async transaction(fn) {
    const c = await this.acquire();
    try {
      await c.exec(this.beginSql);
      const r = await fn({
        query: (s, p) => c.query(s, p),
        exec: (s) => c.exec(s),
      });
      await c.exec("COMMIT");
      return r;
    } catch (e) {
      try {
        await c.exec("ROLLBACK");
      } catch {
        c.dead = true;
      }
      throw e;
    } finally {
      this.release(c);
    }
  }
  async close() {
    this.closed = true;
    for (const w of this.waiters) w.reject(new Error("Pool closed"));
    await Promise.all([...this.all].filter(Boolean).map((c) => c.close()));
    this.all.clear();
    this.idle = [];
  }
}
