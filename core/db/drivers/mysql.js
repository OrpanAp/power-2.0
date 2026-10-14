import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";
import { Pool } from "../pool.js";

const sha1 = (...d) => {
  const h = crypto.createHash("sha1");
  d.forEach((x) => h.update(x));
  return h.digest();
};
const sha256 = (...d) => {
  const h = crypto.createHash("sha256");
  d.forEach((x) => h.update(x));
  return h.digest();
};
const xor = (a, b) => Buffer.from(a.map((v, i) => v ^ b[i % b.length]));

export const scrambleNative = (pw, salt) =>
  pw ? xor(sha1(pw), sha1(salt, sha1(sha1(pw)))) : Buffer.alloc(0);
export const scrambleSha2 = (pw, salt) =>
  pw ? xor(sha256(pw), sha256(sha256(sha256(pw)), salt)) : Buffer.alloc(0);

const CAP = {
  LONG_PASSWORD: 1,
  LONG_FLAG: 4,
  CONNECT_WITH_DB: 8,
  PROTOCOL_41: 0x200,
  SSL: 0x800,
  TRANSACTIONS: 0x2000,
  SECURE_CONNECTION: 0x8000,
  PLUGIN_AUTH: 0x80000,
  LENENC_AUTH: 0x200000,
};

export function readLenEnc(b, p) {
  const f = b[p];
  if (f < 0xfb) return [f, p + 1];
  if (f === 0xfb) return [null, p + 1];
  if (f === 0xfc) return [b.readUInt16LE(p + 1), p + 3];
  if (f === 0xfd) return [b.readUIntLE(p + 1, 3), p + 4];
  return [Number(b.readBigUInt64LE(p + 1)), p + 9];
}
export function lenEnc(n) {
  if (n < 0xfb) return Buffer.from([n]);
  if (n < 0x10000) {
    const b = Buffer.alloc(3);
    b[0] = 0xfc;
    b.writeUInt16LE(n, 1);
    return b;
  }
  if (n < 0x1000000) {
    const b = Buffer.alloc(4);
    b[0] = 0xfd;
    b.writeUIntLE(n, 1, 3);
    return b;
  }
  const b = Buffer.alloc(9);
  b[0] = 0xfe;
  b.writeBigUInt64LE(BigInt(n), 1);
  return b;
}
const lenEncStr = (buf) => Buffer.concat([lenEnc(buf.length), buf]);
const cstrAt = (b, p) => {
  const e = b.indexOf(0, p);
  return [
    b.toString("utf8", p, e < 0 ? b.length : e),
    (e < 0 ? b.length : e) + 1,
  ];
};

const big = (v, unsigned) => {
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : v.toString();
};
const TYPE = {
  TINY: 1,
  SHORT: 2,
  LONG: 3,
  FLOAT: 4,
  DOUBLE: 5,
  NULL: 6,
  TIMESTAMP: 7,
  LONGLONG: 8,
  INT24: 9,
  DATE: 10,
  TIME: 11,
  DATETIME: 12,
  YEAR: 13,
  NEWDECIMAL: 246,
  BLOB: 252,
  VAR_STRING: 253,
};
const pad = (n, w = 2) => String(n).padStart(w, "0");

/** Decode one binary-protocol row (COM_STMT_EXECUTE result). */
export function parseBinaryRow(p, cols) {
  const nb = (cols.length + 9) >> 3,
    bitmap = p.subarray(1, 1 + nb);
  let pos = 1 + nb;
  const row = {};
  cols.forEach((c, i) => {
    if (bitmap[(i + 2) >> 3] & (1 << ((i + 2) & 7))) {
      row[c.name] = null;
      return;
    }
    const un = !!(c.flags & 32);
    switch (c.type) {
      case TYPE.TINY:
        row[c.name] = un ? p.readUInt8(pos) : p.readInt8(pos);
        pos += 1;
        break;
      case TYPE.SHORT:
      case TYPE.YEAR:
        row[c.name] = un ? p.readUInt16LE(pos) : p.readInt16LE(pos);
        pos += 2;
        break;
      case TYPE.LONG:
      case TYPE.INT24:
        row[c.name] = un ? p.readUInt32LE(pos) : p.readInt32LE(pos);
        pos += 4;
        break;
      case TYPE.LONGLONG:
        row[c.name] = big(un ? p.readBigUInt64LE(pos) : p.readBigInt64LE(pos));
        pos += 8;
        break;
      case TYPE.FLOAT:
        row[c.name] = p.readFloatLE(pos);
        pos += 4;
        break;
      case TYPE.DOUBLE:
        row[c.name] = p.readDoubleLE(pos);
        pos += 8;
        break;
      case TYPE.DATE:
      case TYPE.DATETIME:
      case TYPE.TIMESTAMP: {
        const len = p[pos++];
        let s = null;
        if (len >= 4) {
          s = `${pad(p.readUInt16LE(pos), 4)}-${pad(p[pos + 2])}-${pad(p[pos + 3])}`;
          if (len >= 7)
            s += ` ${pad(p[pos + 4])}:${pad(p[pos + 5])}:${pad(p[pos + 6])}`;
        } else s = "0000-00-00";
        row[c.name] = s;
        pos += len;
        break;
      }
      case TYPE.TIME: {
        const len = p[pos++];
        let s = "00:00:00";
        if (len >= 8)
          s = `${p[pos] ? "-" : ""}${pad(p.readUInt32LE(pos + 1) * 24 + p[pos + 5])}:${pad(p[pos + 6])}:${pad(p[pos + 7])}`;
        row[c.name] = s;
        pos += len;
        break;
      }
      default: {
        const [len, np] = readLenEnc(p, pos);
        const raw = p.subarray(np, np + len);
        pos = np + len;
        row[c.name] =
          c.type === TYPE.NEWDECIMAL
            ? Number(raw.toString())
            : c.charset === 63 && c.type >= 249 && c.type <= 254
              ? Buffer.from(raw)
              : raw.toString("utf8");
      }
    }
  });
  return row;
}
function parseTextRow(p, cols) {
  let pos = 0;
  const row = {};
  for (const c of cols) {
    const [len, np] = readLenEnc(p, pos);
    if (len === null) {
      row[c.name] = null;
      pos = np;
      continue;
    }
    const s = p.toString("utf8", np, np + len);
    pos = np + len;
    row[c.name] = [1, 2, 3, 4, 5, 8, 9, 13, 246].includes(c.type)
      ? Number(s)
      : s;
  }
  return row;
}
const parseColDef = (p) => {
  let pos = 0;
  const f = [];
  for (let i = 0; i < 6; i++) {
    const [len, np] = readLenEnc(p, pos);
    f.push(p.toString("utf8", np, np + len));
    pos = np + len;
  }
  pos += 1; // 0x0c
  return {
    name: f[4],
    charset: p.readUInt16LE(pos),
    type: p[pos + 6],
    flags: p.readUInt16LE(pos + 7),
  };
};
const parseErr = (p) => {
  let pos = 3;
  if (p[3] === 0x23) pos = 9;
  const e = new Error(p.toString("utf8", pos));
  e.errno = p.readUInt16LE(1);
  e.sqlState = pos === 9 ? p.toString("ascii", 4, 9) : null;
  return e;
};
const isEof = (p) => p[0] === 0xfe && p.length < 9;

function encodeParams(params) {
  const nb = Buffer.alloc((params.length + 7) >> 3),
    types = [],
    vals = [];
  params.forEach((v, i) => {
    if (v === null || v === undefined) {
      nb[i >> 3] |= 1 << (i & 7);
      types.push(Buffer.from([TYPE.NULL, 0]));
      return;
    }
    if (
      typeof v === "bigint" ||
      (typeof v === "number" && Number.isInteger(v))
    ) {
      const b = Buffer.alloc(8);
      b.writeBigInt64LE(BigInt(v));
      types.push(Buffer.from([TYPE.LONGLONG, 0]));
      vals.push(b);
    } else if (typeof v === "number") {
      const b = Buffer.alloc(8);
      b.writeDoubleLE(v);
      types.push(Buffer.from([TYPE.DOUBLE, 0]));
      vals.push(b);
    } else if (Buffer.isBuffer(v)) {
      types.push(Buffer.from([TYPE.BLOB, 0]));
      vals.push(lenEncStr(v));
    } else {
      types.push(Buffer.from([TYPE.VAR_STRING, 0]));
      vals.push(
        lenEncStr(
          Buffer.from(
            v instanceof Date
              ? v.toISOString().replace("T", " ").slice(0, 19)
              : String(v),
          ),
        ),
      );
    }
  });
  return Buffer.concat([nb, Buffer.from([1]), ...types, ...vals]);
}

class MyConnection {
  constructor(o) {
    this.o = o;
    this.buf = Buffer.alloc(0);
    this.queue = [];
    this.waiters = [];
    this.dead = false;
    this.lastSeq = 0;
  }

  _wire() {
    this.socket.on("data", (c) => {
      this.buf = Buffer.concat([this.buf, c]);
      while (this.buf.length >= 4) {
        const len = this.buf.readUIntLE(0, 3);
        if (this.buf.length < 4 + len) break;
        const pkt = { seq: this.buf[3], p: this.buf.subarray(4, 4 + len) };
        this.buf = this.buf.subarray(4 + len);
        const w = this.waiters.shift();
        if (w) w.resolve(pkt);
        else this.queue.push(pkt);
      }
    });
    const die = (e) => {
      this.dead = true;
      e.connectionLost = true;
      this.waiters.splice(0).forEach((w) => w.reject(e));
    };
    this.socket.on("error", die);
    this.socket.on("close", () => die(new Error("MySQL connection closed")));
  }
  _next() {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.dead) {
      const e = new Error("MySQL connection is closed");
      e.connectionLost = true;
      return Promise.reject(e);
    }
    return new Promise((resolve, reject) =>
      this.waiters.push({ resolve, reject }),
    );
  }
  async _read() {
    const k = await this._next();
    this.lastSeq = k.seq;
    return k.p;
  }
  _write(payload, seq) {
    const h = Buffer.alloc(4);
    h.writeUIntLE(payload.length, 0, 3);
    h[3] = seq & 0xff;
    if (payload.length >= 0xffffff) throw new Error("Packet too large");
    this.socket.write(Buffer.concat([h, payload]));
  }
  _reply(payload) {
    this._write(payload, this.lastSeq + 1);
  }

  async connect() {
    const o = this.o;
    this.socket = net.connect({ host: o.host, port: o.port });
    this.socket.setNoDelay(true);
    await new Promise((res, rej) => {
      const t = setTimeout(
        () => rej(new Error("MySQL connect timeout")),
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
    const hs = await this._read();
    if (hs[0] === 0xff) throw parseErr(hs);
    let [, pos] = cstrAt(hs, 1);
    pos += 4;
    const part1 = hs.subarray(pos, pos + 8);
    pos += 9;
    let capLow = hs.readUInt16LE(pos);
    pos += 5; // caps(2) + charset(1) + status(2)
    const capHigh = hs.readUInt16LE(pos);
    pos += 2;
    const serverCaps = capLow | (capHigh << 16);
    const authLen = hs[pos];
    pos += 11; // len(1) + reserved(10)
    const part2 = hs.subarray(pos, pos + Math.max(13, authLen - 8) - 1);
    pos += Math.max(13, authLen - 8);
    let salt = Buffer.concat([part1, part2]);
    let [plugin] = cstrAt(hs, pos);
    plugin = plugin || "mysql_native_password";

    let caps =
      CAP.LONG_PASSWORD |
      CAP.LONG_FLAG |
      CAP.PROTOCOL_41 |
      CAP.TRANSACTIONS |
      CAP.SECURE_CONNECTION |
      CAP.PLUGIN_AUTH |
      CAP.LENENC_AUTH |
      (o.database ? CAP.CONNECT_WITH_DB : 0);
    if (o.ssl) {
      if (!(serverCaps & CAP.SSL))
        throw new Error(
          "MySQL server does not support TLS (required by configuration)",
        );
      caps |= CAP.SSL;
      const req = Buffer.alloc(32);
      req.writeUInt32LE(caps >>> 0, 0);
      req.writeUInt32LE(0x1000000, 4);
      req[8] = 45;
      this._reply(req);
      this.socket.removeAllListeners("data");
      this.socket.removeAllListeners("error");
      this.socket.removeAllListeners("close");
      this.socket = tls.connect({
        socket: this.socket,
        servername: net.isIP(o.host) ? undefined : o.host,
        rejectUnauthorized: o.ssl.verify,
        ca: o.ssl.ca,
        minVersion: "TLSv1.2",
      });
      await new Promise((res, rej) => {
        this.socket.once("secureConnect", res);
        this.socket.once("error", rej);
      });
      this._wire();
    }
    const scramble = (pl, s) =>
      pl === "caching_sha2_password"
        ? scrambleSha2(o.password || "", s)
        : pl === "mysql_native_password"
          ? scrambleNative(o.password || "", s)
          : (() => {
              throw new Error(`MySQL auth plugin "${pl}" is not supported`);
            })();
    const head = Buffer.alloc(32);
    head.writeUInt32LE(caps >>> 0, 0);
    head.writeUInt32LE(0x1000000, 4);
    head[8] = 45;
    const auth = scramble(plugin, salt);
    this._reply(
      Buffer.concat([
        head,
        Buffer.from(o.user + "\0"),
        lenEncStr(auth),
        Buffer.from(o.database ? o.database + "\0" : ""),
        Buffer.from(plugin + "\0"),
      ]),
    );

    for (;;) {
      const p = await this._read();
      if (p[0] === 0x00) break;
      if (p[0] === 0xff) throw parseErr(p);
      if (p[0] === 0xfe) {
        // auth switch
        let [np, q] = cstrAt(p, 1);
        plugin = np;
        salt = p.subarray(q, p.length - 1);
        this._reply(scramble(plugin, salt));
        continue;
      }
      if (p[0] === 0x01 && plugin === "caching_sha2_password") {
        if (p[1] === 0x03) continue; // fast auth OK, OK packet follows
        if (p[1] === 0x04) {
          // full auth
          const pw = Buffer.from((o.password || "") + "\0");
          if (o.ssl) {
            this._reply(pw);
            continue;
          }
          this._reply(Buffer.from([0x02]));
          const key = await this._read();
          const enc = crypto.publicEncrypt(
            {
              key: key.subarray(1).toString(),
              padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            },
            xor(pw, salt),
          );
          this._reply(enc);
          continue;
        }
      }
      throw new Error("Unexpected MySQL authentication response");
    }
    await this.exec("SET NAMES utf8mb4");
    await this.exec(
      "SET SESSION sql_mode = 'STRICT_ALL_TABLES,ONLY_FULL_GROUP_BY,NO_ENGINE_SUBSTITUTION,NO_BACKSLASH_ESCAPES', time_zone = '+00:00'",
    );
  }

  async _result(first, binary) {
    if (first[0] === 0xff) throw parseErr(first);
    if (first[0] === 0x00) {
      let [affected, p] = readLenEnc(first, 1);
      const [lastId] = readLenEnc(first, p);
      return { rows: [], changes: affected, lastId };
    }
    const [ncols] = readLenEnc(first, 0);
    const cols = [];
    for (let i = 0; i < ncols; i++) cols.push(parseColDef(await this._read()));
    await this._read(); // EOF after column defs
    const rows = [];
    for (;;) {
      const p = await this._read();
      if (p[0] === 0xff) throw parseErr(p);
      if (isEof(p)) break;
      rows.push(binary ? parseBinaryRow(p, cols) : parseTextRow(p, cols));
    }
    return { rows, changes: 0, lastId: null };
  }

  /** Text protocol: only for statements WITHOUT user data (DDL, SET, BEGIN/COMMIT). */
  async exec(sql) {
    this._write(Buffer.concat([Buffer.from([0x03]), Buffer.from(sql)]), 0);
    return this._result(await this._read(), false);
  }
  /** Server-side prepared statement + binary protocol: parameters never touch the SQL text. */
  async query(sql, params = []) {
    this._write(Buffer.concat([Buffer.from([0x16]), Buffer.from(sql)]), 0);
    const ok = await this._read();
    if (ok[0] === 0xff) throw parseErr(ok);
    const id = ok.readUInt32LE(1),
      ncols = ok.readUInt16LE(5),
      nparams = ok.readUInt16LE(7);
    try {
      if (nparams) {
        for (let i = 0; i < nparams; i++) await this._read();
        await this._read();
      }
      if (ncols) {
        for (let i = 0; i < ncols; i++) await this._read();
        await this._read();
      }
      if (nparams !== params.length)
        throw new Error(
          `Expected ${nparams} bound parameters, got ${params.length}`,
        );
      const head = Buffer.alloc(10);
      head[0] = 0x17;
      head.writeUInt32LE(id, 1);
      head[5] = 0;
      head.writeUInt32LE(1, 6);
      this._write(
        nparams ? Buffer.concat([head, encodeParams(params)]) : head,
        0,
      );
      return await this._result(await this._read(), true);
    } finally {
      if (!this.dead) {
        const c = Buffer.alloc(5);
        c[0] = 0x19;
        c.writeUInt32LE(id, 1);
        this._write(c, 0);
      }
    }
  }
  async close() {
    this.dead = true;
    try {
      this._write(Buffer.from([0x01]), 0);
      this.socket.end();
    } catch {
      /* ignore */
    }
  }
}

export function createMysqlDriver(o) {
  const pool = new Pool(
    async () => {
      const c = new MyConnection(o);
      try {
        await c.connect();
      } catch (e) {
        c.socket?.destroy();
        throw e;
      }
      return c;
    },
    { max: o.poolMax || 5, beginSql: "START TRANSACTION" },
  );
  return {
    dialect: "mysql",
    query: (sql, params) => pool.query(sql, params),
    exec: (sql) => pool.exec(sql),
    transaction: (fn) => pool.transaction(fn),
    info: () => ({
      driver: "mysql",
      target: `${o.host}:${o.port}/${o.database}`,
      sizeBytes: null,
    }),
    close: () => pool.close(),
  };
}
