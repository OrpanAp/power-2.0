// Protocol-level tests for the zero-dependency PostgreSQL and MySQL drivers.
// They verify crypto against RFC vectors and wire framing against minimal fake servers
// (NOT a substitute for the live-server tests in db.test.js: set TEST_PG_URL / TEST_MYSQL_URL).
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { setupEnv } from "./helpers.js";

setupEnv();
const { scramClientFinal, createPostgresDriver } =
  await import("../core/db/drivers/postgres.js");
const my = await import("../core/db/drivers/mysql.js");

test("SCRAM-SHA-256 matches the RFC 7677 test vector", async () => {
  const r = await scramClientFinal({
    password: "pencil",
    clientNonce: "rOprNGfwEbeRWgbNEkqO",
    clientFirstBare: "n=user,r=rOprNGfwEbeRWgbNEkqO",
    serverFirst:
      "r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096",
  });
  assert.equal(
    r.clientFinal,
    "c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=",
  );
  assert.equal(
    r.serverSignature,
    "6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=",
  );
  await assert.rejects(
    () =>
      scramClientFinal({
        password: "x",
        clientNonce: "abc",
        clientFirstBare: "n=,r=abc",
        serverFirst: "r=zzz,s=AA==,i=4096",
      }),
    /nonce/,
  );
  await assert.rejects(
    () =>
      scramClientFinal({
        password: "x",
        clientNonce: "abc",
        clientFirstBare: "n=,r=abc",
        serverFirst: "r=abcd,s=AA==,i=1",
      }),
    /iteration/,
  ); // downgrade attack
});

/* ---------- fake PostgreSQL server (trust auth, extended protocol) ---------- */
const i32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};
const i16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n);
  return b;
};
const pmsg = (t, ...p) => {
  const body = Buffer.concat(p);
  return Buffer.concat([Buffer.from(t), i32(body.length + 4), body]);
};
const z = (s) => Buffer.from(s + "\0");

function fakePg(seen) {
  return net.createServer((sock) => {
    let buf = Buffer.alloc(0),
      started = false,
      pending = {};
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (!started) {
          if (buf.length < 4 || buf.length < buf.readInt32BE(0)) return;
          const len = buf.readInt32BE(0);
          seen.startup = buf.subarray(8, len).toString().split("\0");
          buf = buf.subarray(len);
          started = true;
          sock.write(
            Buffer.concat([
              pmsg("R", i32(0)),
              pmsg("S", z("server_version"), z("16.0")),
              pmsg("K", i32(1), i32(2)),
              pmsg("Z", Buffer.from("I")),
            ]),
          );
          continue;
        }
        if (buf.length < 5 || buf.length < 1 + buf.readInt32BE(1)) return;
        const t = String.fromCharCode(buf[0]),
          body = buf.subarray(5, 1 + buf.readInt32BE(1));
        buf = buf.subarray(1 + buf.readInt32BE(1));
        if (t === "P") {
          const e = body.indexOf(0, 1);
          pending.sql = body.toString(
            "utf8",
            1,
            body.indexOf(0, 1 + 0) < 0 ? undefined : undefined,
          );
          const s0 = body.indexOf(0);
          pending.sql = body.toString("utf8", s0 + 1, body.indexOf(0, s0 + 1));
        }
        if (t === "B") {
          let p = body.indexOf(0) + 1;
          p = body.indexOf(0, p) + 1;
          const nf = body.readInt16BE(p);
          p += 2 + nf * 2;
          const np = body.readInt16BE(p);
          p += 2;
          pending.params = [];
          for (let i = 0; i < np; i++) {
            const l = body.readInt32BE(p);
            p += 4;
            if (l < 0) pending.params.push(null);
            else {
              pending.params.push(body.toString("utf8", p, p + l));
              p += l;
            }
          }
        }
        if (t === "Q") {
          seen.simple = (seen.simple || []).concat(
            body.toString("utf8", 0, body.length - 1),
          );
          sock.write(
            Buffer.concat([pmsg("C", z("BEGIN")), pmsg("Z", Buffer.from("T"))]),
          );
        }
        if (t === "S") {
          seen.sql = pending.sql;
          seen.params = pending.params;
          const out = [pmsg("1"), pmsg("2")];
          if (pending.sql.includes("FAIL"))
            out.push(
              pmsg(
                "E",
                Buffer.from("SERROR\0"),
                Buffer.from("C42P01\0"),
                Buffer.from("Mrelation does not exist\0"),
                Buffer.from([0]),
              ),
            );
          else {
            const fd = (name, oid) =>
              Buffer.concat([
                z(name),
                i32(0),
                i16(0),
                i32(oid),
                i16(8),
                i32(-1),
                i16(0),
              ]);
            out.push(
              pmsg("T", i16(3), fd("id", 20), fd("name", 25), fd("ok", 16)),
            );
            const col = (s) =>
              s === null
                ? i32(-1)
                : Buffer.concat([i32(Buffer.byteLength(s)), Buffer.from(s)]);
            out.push(
              pmsg("D", i16(3), col("42"), col("Zoë"), col("t")),
              pmsg("D", i16(3), col("7"), col(null), col("f")),
            );
            out.push(
              pmsg(
                "C",
                z(pending.sql.startsWith("UPDATE") ? "UPDATE 3" : "SELECT 2"),
              ),
            );
          }
          out.push(pmsg("Z", Buffer.from("I")));
          sock.write(Buffer.concat(out));
          pending = {};
        }
      }
    });
    sock.on("error", () => {});
  });
}

test("PostgreSQL driver: framing, parameter encoding, type decoding, errors, simple protocol", async () => {
  const seen = {},
    srv = fakePg(seen);
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const drv = createPostgresDriver({
    host: "127.0.0.1",
    port: srv.address().port,
    user: "u",
    password: "",
    database: "d",
    ssl: null,
    poolMax: 2,
  });
  try {
    const r = await drv.query("SELECT ? AS a, ? AS b, ? AS c, '?' AS q", [
      1,
      "o'brien; DROP TABLE x",
      null,
    ]);
    assert.deepEqual(r.rows, [
      { id: 42, name: "Zoë", ok: true },
      { id: 7, name: null, ok: false },
    ]);
    assert.equal(seen.sql, "SELECT $1 AS a, $2 AS b, $3 AS c, '?' AS q"); // values travel as parameters, not SQL text
    assert.deepEqual(seen.params, ["1", "o'brien; DROP TABLE x", null]);
    assert.ok(seen.startup.includes("statement_timeout"));
    assert.ok(seen.startup.includes("UTF8"));
    assert.equal((await drv.query("UPDATE t SET a = ?", [1])).changes, 3); // parsed from the CommandComplete tag
    await assert.rejects(
      () => drv.query("SELECT FAIL", []),
      (e) => e.code === "42P01" && /does not exist/.test(e.message),
    );
    assert.equal((await drv.query("SELECT 1", [])).rows.length, 2); // connection usable after an error
    await drv.exec("BEGIN");
    assert.deepEqual(seen.simple, ["BEGIN"]);
    const tx = await drv.transaction(
      async (h) => (await h.query("SELECT 1", [])).rows.length,
    );
    assert.equal(tx, 2);
  } finally {
    await drv.close();
    srv.close();
  }
});

/* ---------- MySQL primitives + fake server ---------- */
test("MySQL length-encoded integers round-trip", () => {
  for (const n of [0, 250, 251, 65535, 65536, 16777215, 16777216, 2 ** 40]) {
    const [v, p] = my.readLenEnc(my.lenEnc(n), 0);
    assert.equal(v, n);
    assert.equal(p, my.lenEnc(n).length);
  }
});
test("MySQL scrambles are 20 / 32 bytes and password-dependent", () => {
  const salt = Buffer.from("0123456789abcdefghij");
  assert.equal(my.scrambleNative("pw", salt).length, 20);
  assert.equal(my.scrambleSha2("pw", salt).length, 32);
  assert.notDeepEqual(
    my.scrambleNative("pw", salt),
    my.scrambleNative("pw2", salt),
  );
  assert.equal(my.scrambleNative("", salt).length, 0);
});
test("MySQL binary row decoding (ints, unsigned, NULL, strings, datetime, double)", () => {
  const cols = [
    { name: "a", type: 8, flags: 0 },
    { name: "b", type: 253, flags: 0, charset: 45 },
    { name: "c", type: 3, flags: 32 },
    { name: "d", type: 12, flags: 0 },
    { name: "e", type: 5, flags: 0 },
    { name: "f", type: 3, flags: 0 },
  ];
  const lenStr = Buffer.concat([Buffer.from([4]), Buffer.from("Zoë")]);
  const i64 = Buffer.alloc(8);
  i64.writeBigInt64LE(-5n);
  const u32 = Buffer.alloc(4);
  u32.writeUInt32LE(4000000000);
  const dt = Buffer.from([7, 0xe9, 0x07, 3, 14, 10, 20, 30]); // 2025-03-14 10:20:30
  const dbl = Buffer.alloc(8);
  dbl.writeDoubleLE(1.5);
  const bitmap = Buffer.alloc((cols.length + 9) >> 3);
  bitmap[(5 + 2) >> 3] |= 1 << ((5 + 2) & 7); // column f is NULL
  const row = my.parseBinaryRow(
    Buffer.concat([Buffer.from([0]), bitmap, i64, lenStr, u32, dt, dbl]),
    cols,
  );
  assert.deepEqual(row, {
    a: -5,
    b: "Zoë",
    c: 4000000000,
    d: "2025-03-14 10:20:30",
    e: 1.5,
    f: null,
  });
});

function fakeMysql(seen) {
  const salt = Buffer.from("abcdefghijklmnopqrst");
  const pkt = (seq, ...p) => {
    const body = Buffer.concat(p);
    const h = Buffer.alloc(4);
    h.writeUIntLE(body.length, 0, 3);
    h[3] = seq;
    return Buffer.concat([h, body]);
  };
  const col = (name, type, flags = 0) =>
    Buffer.concat([
      ...["def", "", "", "", name, name].map((s) =>
        Buffer.concat([my.lenEnc(s.length), Buffer.from(s)]),
      ),
      Buffer.from([0x0c, 45, 0, 0, 0, 0, 0, type, flags, 0, 0, 0, 0, 0]),
    ]);
  const eof = (seq) => pkt(seq, Buffer.from([0xfe, 0, 0, 2, 0]));
  const ok = (seq, affected = 0, id = 0) =>
    pkt(seq, Buffer.from([0, affected, id, 2, 0, 0, 0]));
  return net.createServer((sock) => {
    let buf = Buffer.alloc(0),
      authed = false;
    sock.write(
      pkt(
        0,
        Buffer.from([10]),
        Buffer.from("8.0.fake\0"),
        Buffer.from([1, 0, 0, 0]),
        salt.subarray(0, 8),
        Buffer.from([0]),
        Buffer.from([0x08, 0x82, 45, 2, 0, 0x08, 0x00, 21]),
        Buffer.alloc(10),
        salt.subarray(8),
        Buffer.from([0]),
        Buffer.from("mysql_native_password\0"),
      ),
    );
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4 && buf.length >= 4 + buf.readUIntLE(0, 3)) {
        const len = buf.readUIntLE(0, 3),
          p = buf.subarray(4, 4 + len);
        buf = buf.subarray(4 + len);
        if (!authed) {
          const [user, e] = [
            p.toString("utf8", 32, p.indexOf(0, 32)),
            p.indexOf(0, 32) + 1,
          ];
          const [alen, ap] = my.readLenEnc(p, e);
          seen.user = user;
          seen.authOk = p
            .subarray(ap, ap + alen)
            .equals(my.scrambleNative("pw", salt));
          authed = true;
          sock.write(ok(2));
          continue;
        }
        const cmd = p[0];
        if (cmd === 0x03) {
          (seen.text ||= []).push(p.toString("utf8", 1));
          sock.write(ok(1));
        } else if (cmd === 0x16) {
          seen.prepared = p.toString("utf8", 1);
          sock.write(
            Buffer.concat([
              pkt(1, Buffer.from([0, 1, 0, 0, 0, 2, 0, 2, 0, 0, 0, 0])),
              pkt(2, col("?", 253)),
              pkt(3, col("?", 253)),
              eof(4),
              pkt(5, col("id", 8)),
              pkt(6, col("name", 253)),
              eof(7),
            ]),
          );
        } else if (cmd === 0x17) {
          let q = 10;
          const nb = p[q];
          q += (2 + 7) >> 3;
          q += 1;
          const types = [p[q], p[q + 2]];
          q += 4;
          const n = Number(p.readBigInt64LE(q));
          q += 8;
          const [sl, sp] = my.readLenEnc(p, q);
          seen.exec = { types, n, s: p.toString("utf8", sp, sp + sl) };
          const val = Buffer.concat([
            Buffer.from([0, 0]),
            (() => {
              const b = Buffer.alloc(8);
              b.writeBigInt64LE(99n);
              return b;
            })(),
            Buffer.from([4]),
            Buffer.from("Zoë"),
          ]);
          sock.write(
            Buffer.concat([
              pkt(1, Buffer.from([2])),
              pkt(2, col("id", 8)),
              pkt(3, col("name", 253)),
              eof(4),
              pkt(5, val),
              eof(6),
            ]),
          );
        } else if (cmd === 0x19) seen.closed = true;
      }
    });
    sock.on("error", () => {});
  });
}
test("MySQL driver: native auth, prepared statements with binary-encoded parameters, result decoding", async () => {
  const seen = {},
    srv = fakeMysql(seen);
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const drv = my.createMysqlDriver({
    host: "127.0.0.1",
    port: srv.address().port,
    user: "u",
    password: "pw",
    database: "d",
    ssl: null,
    poolMax: 1,
  });
  try {
    const r = await drv.query("SELECT id, name FROM t WHERE a = ? AND b = ?", [
      7,
      "x'; DROP TABLE t; --",
    ]);
    assert.deepEqual(r.rows, [{ id: 99, name: "Zoë" }]);
    assert.equal(seen.user, "u");
    assert.ok(seen.authOk, "mysql_native_password scramble verified");
    assert.equal(seen.prepared, "SELECT id, name FROM t WHERE a = ? AND b = ?"); // SQL text carries no values
    assert.deepEqual(seen.exec, {
      types: [8, 253],
      n: 7,
      s: "x'; DROP TABLE t; --",
    }); // int → LONGLONG, string → VAR_STRING
    assert.ok(
      seen.text.some((s) => s.includes("NO_BACKSLASH_ESCAPES")) &&
        seen.text.some((s) => s.startsWith("SET NAMES utf8mb4")),
    );
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(seen.closed, "statement closed");
    await assert.rejects(
      () => drv.query("SELECT ?", []),
      /Expected 2|Expected 1|bound parameters/,
    );
  } finally {
    await drv.close();
    srv.close();
  }
});
