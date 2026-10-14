import crypto from "node:crypto";
import { db } from "./database.js";
import { randomToken } from "./security.js";

const SID = /^[A-Za-z0-9_-]{32,64}$/;
const uaHash = (req) =>
  crypto
    .createHash("sha256")
    .update(String(req.headers["user-agent"] || ""))
    .digest("hex")
    .slice(0, 16);

export class Session {
  constructor(
    store,
    { id = null, data = {}, userId = null, isNew = true } = {},
  ) {
    this.store = store;
    this.id = id || randomToken(32);
    this.data = data;
    this.userId = userId;
    this.isNew = isNew;
    this.dirty = false;
    this.destroyed = false;
    this.flashed = data._flash || {}; // flash set during the previous request
    this.data._flash = {};
    if (Object.keys(this.flashed).length) this.dirty = true;
  }
  get(k, d = undefined) {
    return k in this.data ? this.data[k] : d;
  }
  set(k, v) {
    this.data[k] = v;
    this.dirty = true;
  }
  forget(k) {
    delete this.data[k];
    this.dirty = true;
  }
  flash(k, v) {
    this.data._flash[k] = v;
    this.dirty = true;
  }
  csrfToken() {
    if (!this.data._csrf) {
      this.data._csrf = randomToken(32);
      this.dirty = true;
    }
    return this.data._csrf;
  }
  /** Fresh session id + CSRF token (call after any privilege change). Keeps data and user. */
  regenerate() {
    this._stale = this.isNew ? this._stale : this.id; // old row is deleted when we save
    this.id = randomToken(32);
    this.isNew = true;
    delete this.data._csrf;
    this.data._created = Date.now();
    this.dirty = true;
  }
  login(userId) {
    this.regenerate();
    this.userId = userId;
    this.dirty = true;
  }
  destroy() {
    if (!this.isNew) this._stale = this.id;
    this.id = randomToken(32);
    this.data = { _flash: {}, _created: Date.now(), _ua: this.data._ua };
    this.userId = null;
    this.isNew = true;
    this.dirty = false;
    this.destroyed = true;
    this.flashed = {};
  }
}

/** Server-side sessions. Cookie = random id; DB key = HMAC(secret, id), so a database leak can't be replayed as cookies. */
export class SessionStore {
  constructor(secret, { idleMs, absoluteMs }) {
    this.secret = secret;
    this.ttl = idleMs;
    this.absolute = absoluteMs;
  }
  key(id) {
    return crypto.createHmac("sha256", this.secret).update(id).digest("hex");
  }
  blank() {
    return new Session(this);
  }
  async load(id) {
    if (!SID.test(id)) return null;
    const row = await db.get(
      "SELECT * FROM sessions WHERE id = ? AND expires_at > ?",
      [this.key(id), Date.now()],
    );
    if (!row) return null;
    let data = {};
    try {
      data = JSON.parse(row.data);
    } catch {
      /* reset */
    }
    const s = new Session(this, {
      id,
      data,
      userId: row.user_id,
      isNew: false,
    });
    if (Number(row.expires_at) - Date.now() < this.ttl / 2) s.dirty = true; // sliding idle expiry
    return s;
  }
  async save(s) {
    if (s._stale) {
      await this.remove(s._stale);
      s._stale = null;
    }
    const now = Date.now();
    await db.upsert(
      "sessions",
      {
        id: this.key(s.id),
        user_id: s.userId,
        data: JSON.stringify(s.data),
        created_at: now,
        expires_at: now + this.ttl,
      },
      ["id"],
      ["user_id", "data", "expires_at"],
    );
  }
  remove(id) {
    return db.run("DELETE FROM sessions WHERE id = ?", [this.key(id)]);
  }
  /** Revoke every session of a user (optionally keeping the current one) — after password change / disable. */
  revokeUser(userId, exceptId = null) {
    return exceptId
      ? db.run("DELETE FROM sessions WHERE user_id = ? AND id != ?", [
          userId,
          this.key(exceptId),
        ])
      : db.run("DELETE FROM sessions WHERE user_id = ?", [userId]);
  }
  gc() {
    return db.run("DELETE FROM sessions WHERE expires_at <= ?", [Date.now()]);
  }
}

/** Lazy sessions: nothing is stored or set as a cookie until the session holds data. Enforces absolute lifetime + user-agent binding. */
export function sessionMiddleware(store, { cookieName }) {
  setInterval(
    () => {
      store.gc().catch(() => {});
    },
    15 * 60 * 1000,
  ).unref();
  return async (req, res, next) => {
    const sid = req.cookies[cookieName];
    let s = sid ? await store.load(sid) : null;
    if (
      s &&
      (Date.now() - Number(s.data._created || 0) > store.absolute ||
        s.data._ua !== uaHash(req))
    ) {
      await store.remove(sid);
      s = null; // expired absolutely, or cookie replayed from a different client
    }
    if (!s) {
      s = store.blank();
      s.data._created = Date.now();
      s.data._ua = uaHash(req);
    }
    req.session = s;

    const end = res.end;
    res.end = function (...args) {
      res.end = end;
      const finish = () => end.apply(this, args);
      if (res.headersSent) return finish();
      if (s.dirty) {
        if (s.isNew) res.cookie(cookieName, s.id, { maxAge: store.ttl });
        store
          .save(s)
          .catch((e) => console.error("[session]", e.message))
          .finally(finish);
        return this;
      }
      if (s.destroyed) {
        res.clearCookie(cookieName);
        if (s._stale) store.remove(s._stale).catch(() => {});
      }
      return finish();
    };
    next();
  };
}
