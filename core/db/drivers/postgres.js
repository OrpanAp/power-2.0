import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { Pool } from "../pool.js";

const pbkdf2 = promisify(crypto.pbkdf2);
const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
const sha256 = (d) => crypto.createHash("sha256").update(d).digest();

/** SCRAM-SHA-256 client step 2 (RFC 5802 / 7677). Pure function so it can be tested against the RFC vector. */
export async function scramClientFinal({
  password,
  clientFirstBare,
  serverFirst,
  clientNonce,
}) {
  const attrs = Object.fromEntries(
    serverFirst.split(",").map((p) => [p[0], p.slice(2)]),
  );
  if (!attrs.r?.startsWith(clientNonce))
    throw new Error("SCRAM: server nonce mismatch");
  const iterations = Number(attrs.i);
  if (!Number.isInteger(iterations) || iterations < 4096 || iterations > 1e7)
    throw new Error("SCRAM: unacceptable iteration count");
  const salted = await pbkdf2(
    Buffer.from(password.normalize("NFKC")),
    Buffer.from(attrs.s, "base64"),
    iterations,
    32,
    "sha256",
  );
  const clientKey = hmac(salted, "Client Key");
  const noProof = `c=biws,r=${attrs.r}`;
  const authMessage = `${clientFirstBare},${serverFirst},${noProof}`;
  const sig = hmac(sha256(clientKey), authMessage);
  const proof = Buffer.from(clientKey.map((b, i) => b ^ sig[i])).toString(
    "base64",
  );
  const serverSignature = hmac(
    hmac(salted, "Server Key"),
    authMessage,
  ).toString("base64");
  return { clientFinal: `${noProof},p=${proof}`, serverSignature };
}

const i16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n);
  return b;
};
const i32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};
const cstr = (s) => Buffer.from(s + "\0");
const msg = (type, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from(type), i32(body.length + 4), body]);
};

/** Translate `?` placeholders to $1..$n (skipping quoted strings/identifiers). */
export function toPgSql(sql) {
  let out = "",
    n = 0,
    q = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (q) {
      out += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      q = ch;
      out += ch;
      continue;
    }
    out += ch === "?" ? `$${++n}` : ch;
  }
  return out;
}
const encodeParam = (p) =>
  p === null || p === undefined
    ? i32(-1)
    : (() => {
        const b = Buffer.isBuffer(p)
          ? Buffer.from("\\x" + p.toString("hex"))
          : Buffer.from(p instanceof Date ? p.toISOString() : String(p));
        return Buffer.concat([i32(b.length), b]);
      })();

const decode = (oid, txt) => {
  switch (oid) {
    case 16:
      return txt === "t";
    case 20: {
      const n = Number(txt);
      return Number.isSafeInteger(n) ? n : txt;
    }
    case 21:
    case 23:
    case 26:
    case 700:
    case 701:
    case 1700:
      return Number(txt);
    default:
      return txt;
  }
};
const parseError = (b) => {
  const f = {};
  let i = 0;
  while (i < b.length && b[i] !== 0) {
    const code = String.fromCharCode(b[i++]);
    const end = b.indexOf(0, i);
    f[code] = b.toString("utf8", i, end);
    i = end + 1;
  }
  const e = new Error(f.M || "PostgreSQL error");
  e.code = f.C;
  e.detail = f.D;
  e.severity = f.S;
  return e;
};

class PgConnection {
  constructor(o) {
    this.o = o;
    this.buf = Buffer.alloc(0);
    this.cur = null;
    this.dead = false;
    this.raw = null;
  }

  async connect() {
    const { host, port, ssl } = this.o;
    this.socket = net.connect({ host, port });
    this.socket.setNoDelay(true);
    await new Promise((res, rej) => {
      const t = setTimeout(
        () => rej(new Error("PostgreSQL connect timeout")),
        10000,
      );
      this.socket.once("connect", () => {
        clearTimeout(t);
        res();
      });
      this.socket.once("error", (e) => {
        clearTimeout(t);
        rej(e);
      });
    });
    this._wire();
    if (ssl) {
      const reply = await new Promise((res) => {
        this.raw = res;
        this.socket.write(Buffer.concat([i32(8), i32(80877103)]));
      });
      if (reply[0] !== 0x53)
        throw new Error(
          "PostgreSQL server does not support TLS (sslmode requires it)",
        );
      this.socket.removeAllListeners("data");
      this.socket.removeAllListeners("error");
      this.socket.removeAllListeners("close");
      this.socket = tls.connect({
        socket: this.socket,
        servername: net.isIP(host) ? undefined : host,
        rejectUnauthorized: ssl.verify,
        ca: ssl.ca,
        minVersion: "TLSv1.2",
      });
      await new Promise((res, rej) => {
        this.socket.once("secureConnect", res);
        this.socket.once("error", rej);
      });
      this._wire();
    }
    const params = [
      "user",
      this.o.user,
      "database",
      this.o.database,
      "client_encoding",
      "UTF8",
      "statement_timeout",
      String(this.o.statementTimeout || 30000),
      "application_name",
      "power",
    ];
    const startup = Buffer.concat([
      i32(196608),
      ...params.map(cstr),
      Buffer.from([0]),
    ]);
    let scram = null;
    await this._exchange(
      [Buffer.concat([i32(startup.length + 4), startup])],
      (t, b) => {
        if (t !== "R") return;
        const code = b.readInt32BE(0);
        if (code === 0) return;
        if (code === 3)
          return this.socket.write(msg("p", cstr(this.o.password || "")));
        if (code === 5) {
          const md5 = (d) => crypto.createHash("md5").update(d).digest("hex");
          return this.socket.write(
            msg(
              "p",
              cstr(
                "md5" +
                  md5(
                    Buffer.concat([
                      Buffer.from(md5((this.o.password || "") + this.o.user)),
                      b.subarray(4, 8),
                    ]),
                  ),
              ),
            ),
          );
        }
        if (code === 10) {
          if (!b.toString("utf8", 4).includes("SCRAM-SHA-256"))
            throw new Error("PostgreSQL: no supported SASL mechanism");
          const nonce = crypto.randomBytes(18).toString("base64");
          scram = { nonce, bare: `n=,r=${nonce}` };
          const first = Buffer.from(`n,,${scram.bare}`);
          return this.socket.write(
            msg("p", cstr("SCRAM-SHA-256"), i32(first.length), first),
          );
        }
        if (code === 11) {
          const serverFirst = b.toString("utf8", 4);
          scramClientFinal({
            password: this.o.password || "",
            clientFirstBare: scram.bare,
            serverFirst,
            clientNonce: scram.nonce,
          })
            .then((r) => {
              scram.serverSignature = r.serverSignature;
              this.socket.write(msg("p", Buffer.from(r.clientFinal)));
            })
            .catch((e) => this._fail(e));
          return;
        }
        if (code === 12) {
          if (b.toString("utf8", 4) !== `v=${scram.serverSignature}`)
            this._fail(new Error("SCRAM: server signature mismatch"));
          return;
        }
        this._fail(
          new Error(`PostgreSQL auth method ${code} is not supported`),
        );
      },
    );
  }

  _wire() {
    this.socket.on("data", (c) => this._data(c));
    this.socket.on("error", (e) => this._die(e));
    this.socket.on("close", () =>
      this._die(new Error("PostgreSQL connection closed")),
    );
  }
  _die(err) {
    this.dead = true;
    err.connectionLost = true;
    if (this.cur) {
      const c = this.cur;
      this.cur = null;
      c.reject(c.err || err);
    }
  }
  _fail(err) {
    if (this.cur) {
      const c = this.cur;
      this.cur = null;
      c.reject(err);
    }
  }
  _data(chunk) {
    if (this.raw) {
      const f = this.raw;
      this.raw = null;
      return f(chunk);
    }
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 5) {
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < 1 + len) break;
      const t = String.fromCharCode(this.buf[0]),
        body = this.buf.subarray(5, 1 + len);
      this.buf = this.buf.subarray(1 + len);
      this._msg(t, body);
    }
  }
  _msg(t, body) {
    const c = this.cur;
    if (!c) return;
    if (t === "E") {
      c.err = parseError(body);
      return;
    }
    if (t === "Z") {
      this.cur = null;
      return c.err ? c.reject(c.err) : c.resolve();
    }
    try {
      c.onMsg?.(t, body);
    } catch (e) {
      this._fail(e);
    }
  }
  _exchange(bufs, onMsg) {
    return new Promise((resolve, reject) => {
      if (this.dead) {
        const e = new Error("PostgreSQL connection is closed");
        e.connectionLost = true;
        return reject(e);
      }
      if (this.cur) return reject(new Error("Connection busy"));
      this.cur = { resolve, reject, onMsg, err: null };
      for (const b of bufs) this.socket.write(b);
    });
  }

  async query(sql, params = []) {
    const rows = [];
    let fields = null,
      tag = "";
    await this._exchange(
      [
        msg("P", cstr(""), cstr(toPgSql(sql)), i16(0)),
        msg(
          "B",
          cstr(""),
          cstr(""),
          i16(0),
          i16(params.length),
          ...params.map(encodeParam),
          i16(0),
        ),
        msg("D", Buffer.from("P"), cstr("")),
        msg("E", cstr(""), i32(0)),
        msg("S"),
      ],
      (t, b) => {
        if (t === "T") {
          fields = [];
          let p = 2;
          for (let i = 0; i < b.readInt16BE(0); i++) {
            const e = b.indexOf(0, p);
            fields.push({
              name: b.toString("utf8", p, e),
              oid: b.readInt32BE(e + 7),
            });
            p = e + 19;
          }
        } else if (t === "D") {
          const row = {};
          let p = 2;
          for (let i = 0; i < b.readInt16BE(0); i++) {
            const len = b.readInt32BE(p);
            p += 4;
            if (len === -1) row[fields[i].name] = null;
            else {
              row[fields[i].name] = decode(
                fields[i].oid,
                b.toString("utf8", p, p + len),
              );
              p += len;
            }
          }
          rows.push(row);
        } else if (t === "C") tag = b.toString("utf8", 0, b.length - 1);
      },
    );
    const m = /^(INSERT|UPDATE|DELETE|MERGE)\s+(?:\d+\s+)?(\d+)$/.exec(tag);
    return { rows, changes: m ? Number(m[2]) : 0, lastId: null };
  }
  async exec(sql) {
    await this._exchange([msg("Q", cstr(sql))]);
  } // simple protocol: multi-statement DDL/BEGIN/COMMIT
  async close() {
    this.dead = true;
    try {
      this.socket.write(msg("X"));
      this.socket.end();
    } catch {
      /* ignore */
    }
  }
}

export function createPostgresDriver(o) {
  const pool = new Pool(
    async () => {
      const c = new PgConnection(o);
      try {
        await c.connect();
      } catch (e) {
        c.socket?.destroy();
        throw e;
      }
      return c;
    },
    { max: o.poolMax || 5 },
  );
  return {
    dialect: "postgres",
    query: (sql, params) => pool.query(sql, params),
    exec: (sql) => pool.exec(sql),
    transaction: (fn) => pool.transaction(fn),
    info: () => ({
      driver: "postgres",
      target: `${o.host}:${o.port}/${o.database}`,
      sizeBytes: null,
    }),
    close: () => pool.close(),
  };
}
