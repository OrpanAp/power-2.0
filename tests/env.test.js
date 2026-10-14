import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const {
  parseDotenv,
  loadEnvFiles,
  resolveEnv,
  findUnknown,
  describeEnv,
  setEnvVar,
  exampleFile,
  env,
  SCHEMA,
} = await import("../config/env.js");

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "power-env-"));

test("dotenv syntax: quotes, escapes, comments, export, multi-line, expansion", () => {
  const m = parseDotenv(`
# comment
A=1
export B = two words   # trailing comment
C="line1\\nline2 \\"q\\" # not a comment"
D='single $A literal'
E=\${A}-\${MISSING:-fallback}-$A
F="multi
line"
G=https://x.test/#frag
H=\\$notvar
`);
  assert.equal(m.get("A"), "1");
  assert.equal(m.get("B"), "two words");
  assert.equal(m.get("C"), 'line1\nline2 "q" # not a comment');
  assert.equal(m.get("D"), "single $A literal");
  assert.equal(m.get("E"), "1-fallback-1");
  assert.equal(m.get("F"), "multi\nline");
  assert.equal(m.get("G"), "https://x.test/#frag"); // '#' without preceding space is data
  assert.equal(m.get("H"), "$notvar");
});

test("layering: .env < .env.<mode> < .env.local < .env.<mode>.local, real env wins, .env.local skipped in test", () => {
  const root = tmpdir();
  fs.writeFileSync(
    path.join(root, ".env"),
    "A=base\nB=base\nC=base\nD=base\nNODE_ENV=staging\n",
  );
  fs.writeFileSync(
    path.join(root, ".env.staging"),
    "B=staging\nC=staging\nD=staging\n",
  );
  fs.writeFileSync(path.join(root, ".env.local"), "C=local\nD=local\n");
  fs.writeFileSync(
    path.join(root, ".env.staging.local"),
    "D=stagelocal\nE=${A}+${B}\n",
  );
  const e = { A: "process" };
  const r = loadEnvFiles({ root, env: e });
  assert.equal(r.mode, "staging"); // NODE_ENV discovered from .env
  assert.deepEqual(
    [e.A, e.B, e.C, e.D, e.E],
    ["process", "staging", "local", "stagelocal", "process+staging"],
  );
  assert.equal(r.sources.D, ".env.staging.local");
  assert.equal(r.sources.A, "process");
  const t = { NODE_ENV: "test" };
  fs.writeFileSync(path.join(root, ".env.test"), "C=test\n");
  loadEnvFiles({ root, env: t });
  assert.equal(t.C, "test"); // .env.local ignored under test
});

test("KEY_FILE secrets are read from disk (trailing newline trimmed); unreadable file is an error", () => {
  const root = tmpdir();
  fs.writeFileSync(path.join(root, "sec"), "file-secret\n");
  const e = { SESSION_SECRET_FILE: path.join(root, "sec") };
  loadEnvFiles({ root, env: e });
  assert.equal(e.SESSION_SECRET, "file-secret");
  const e2 = {
    SESSION_SECRET: "explicit",
    SESSION_SECRET_FILE: path.join(root, "sec"),
  };
  loadEnvFiles({ root, env: e2 });
  assert.equal(e2.SESSION_SECRET, "explicit");
  assert.throws(
    () =>
      loadEnvFiles({ root, env: { SESSION_SECRET_FILE: "/nonexistent/zzz" } }),
    /cannot read/,
  );
  const other = { PIP_CONFIG_FILE: "/nonexistent/pip.conf" };
  loadEnvFiles({ root, env: other });
  assert.equal(other.PIP_CONFIG, undefined); // unrelated tools' *_FILE variables are ignored
  const db = { DB_REPORTS_URL_FILE: path.join(root, "sec") };
  loadEnvFiles({ root, env: db });
  assert.equal(db.DB_REPORTS_URL, "file-secret");
});

test("schema validation: typed values, every problem reported at once, production requirements", () => {
  const ok = resolveEnv({
    PORT: "8080",
    TRUST_PROXY: "yes",
    ALLOWED_HOSTS: "A.com, b.com",
    DB_POOL_MAX: "10",
  }).values;
  assert.deepEqual(
    [
      ok.PORT,
      ok.TRUST_PROXY,
      ok.ALLOWED_HOSTS,
      ok.DB_POOL_MAX,
      ok.ALLOW_REGISTRATION,
    ],
    [8080, true, ["a.com", "b.com"], 10, true],
  );
  const bad = resolveEnv({
    PORT: "abc",
    FORCE_HTTPS: "maybe",
    DB_POOL_MAX: "0",
    DB_URL: "oracle://x",
  });
  assert.equal(bad.errors.length, 4);
  const prod = resolveEnv(
    { NODE_ENV: "production", SESSION_SECRET: "short" },
    { mode: "production" },
  );
  assert.ok(prod.errors.some((e) => /SESSION_SECRET.*at least 32/.test(e)));
  assert.ok(
    resolveEnv({}, { mode: "production" }).errors.some((e) =>
      /SESSION_SECRET is required in production/.test(e),
    ),
  );
  assert.ok(
    resolveEnv(
      { SESSION_SECRET: "x".repeat(40) },
      { mode: "production" },
    ).warnings.some((w) => /ALLOWED_HOSTS/.test(w)),
  );
  assert.equal(
    resolveEnv({ SESSION_SECRET: "x".repeat(40) }, { mode: "production" })
      .errors.length,
    0,
  );
});

test("typo detection suggests the real setting", () => {
  const w = findUnknown([
    "SESSON_SECRET",
    "PUBLIC_FOO",
    "DB_REPORTS_URL",
    "WHOLLY_CUSTOM",
    "ALLOWED_HOST",
  ]);
  assert.ok(w.some((x) => /SESSON_SECRET.*SESSION_SECRET/.test(x)));
  assert.ok(w.some((x) => /ALLOWED_HOST .*ALLOWED_HOSTS/.test(x)));
  assert.ok(!w.some((x) => /PUBLIC_FOO|DB_REPORTS_URL/.test(x)));
});

test("env:check never prints secrets; env:set preserves the file and quotes safely", () => {
  const root = tmpdir();
  fs.writeFileSync(
    path.join(root, ".env"),
    "SESSION_SECRET=" + "z".repeat(40) + "\nPORT=4000\n",
  );
  const d = describeEnv({ root, mode: "development", env: { PATH: "/bin" } });
  const sec = d.rows.find((r) => r.key === "SESSION_SECRET");
  assert.ok(!sec.value.includes("zzzz"));
  assert.match(sec.value, /40 chars/);
  assert.equal(sec.source, ".env");
  assert.equal(d.rows.find((r) => r.key === "PORT").value, "4000");
  assert.equal(d.rows.find((r) => r.key === "HOST").source, "default");

  const f = path.join(root, ".env.local");
  setEnvVar(f, "APP_NAME", 'My "App" $1 # x');
  setEnvVar(f, "PORT", "5000");
  setEnvVar(f, "PORT", "5001");
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  const back = parseDotenv(fs.readFileSync(f, "utf8"));
  assert.equal(back.get("APP_NAME"), 'My "App" $1 # x');
  assert.equal(back.get("PORT"), "5001");
  assert.equal(fs.readFileSync(f, "utf8").match(/PORT=/g).length, 1);
  assert.throws(() => setEnvVar(f, "bad key", "1"), /Invalid variable name/);
});

test("example file covers every setting; env helper coerces", () => {
  const ex = exampleFile();
  for (const k of Object.keys(SCHEMA)) assert.ok(ex.includes(k), k);
  process.env.T_INT = "42";
  process.env.T_BOOL = "off";
  process.env.T_LIST = "a, b";
  assert.equal(env.int("T_INT", 1), 42);
  assert.equal(env.bool("T_BOOL", true), false);
  assert.deepEqual(env.list("T_LIST"), ["a", "b"]);
  assert.equal(env("T_NOPE", "d"), "d");
  assert.throws(() => env.required("T_NOPE"), /Missing required/);
});
