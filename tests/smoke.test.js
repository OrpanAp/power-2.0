import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setupEnv, Client, rawRequest } from "./helpers.js";

const tmp = setupEnv();
const { boot } = await import("../app.js");
const { db, manager } = await import("../core/database.js");
const { User } = await import("../app/models/User.js");
const { hotp, verifyTotp } = await import("../core/totp.js");

let app, base, port;
before(async () => {
  app = await boot({ quiet: true });
  port = (await app.listen(0, "127.0.0.1")).port;
  base = `http://127.0.0.1:${port}`;
});
after(async () => {
  await app.close();
  await manager.closeAll();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const STRONG = "Tr0ub4dor&3-horse-staple";
const email0 = "admin@power.local",
  pass0 = "Adm1n-Test-Pass!";
const register = async (c, email, name = "Test User", password = STRONG) =>
  c.post("/register", {
    name,
    email,
    password,
    password_confirmation: password,
  });

test("headers, static files, traversal and host-header guard", async () => {
  const c = new Client(base);
  const h = await c.req("GET", "/health");
  assert.equal(h.status, 200);
  assert.deepEqual(JSON.parse(h.text), { status: "ok" });
  for (const name of [
    "content-security-policy",
    "x-frame-options",
    "cross-origin-opener-policy",
    "cross-origin-resource-policy",
    "permissions-policy",
  ])
    assert.ok(h.headers.get(name), name);
  assert.match(h.headers.get("cache-control"), /no-store/);
  assert.equal(h.headers.get("referrer-policy"), "same-origin"); // 'no-referrer' makes browsers send Origin: null on form posts
  assert.equal(h.headers.get("cross-origin-embedder-policy"), null);
  assert.equal((await c.req("GET", "/css/app.css")).status, 200);
  assert.equal((await c.req("GET", "/../config/config.js")).status, 404);
  assert.equal((await c.req("GET", "/%2e%2e/config/config.js")).status, 404);
  assert.equal(await rawRequest(port, "evil.example.com"), 400);
  assert.equal(await rawRequest(port, `localhost:${port}`, "/health"), 200);
});

test("CSRF is enforced; cross-origin posts are blocked", async () => {
  const c = new Client(base);
  const t = await c.csrf("/login");
  assert.equal(
    (
      await c.req("POST", "/login", {
        email: "admin@power.local",
        password: "x",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await c.req(
        "POST",
        "/login",
        { _csrf: t, email: "a@b.co", password: "x" },
        { origin: "https://evil.example" },
      )
    ).status,
    403,
  );
});

test("session cookie is HttpOnly + SameSite and rotated on login", async () => {
  const c = new Client(base);
  await c.csrf("/login");
  const before = c.jar.power_sid;
  assert.match(c.setCookies[0], /HttpOnly/);
  assert.match(c.setCookies[0], /SameSite=Lax/);
  await c.login("admin@power.local", "Adm1n-Test-Pass!");
  assert.notEqual(c.jar.power_sid, before); // fixation defence
  assert.equal((await c.req("GET", "/admin")).status, 200);
});

test("admin dashboard, RBAC and secret masking in the table browser", async () => {
  const c = new Client(base);
  assert.equal((await c.req("GET", "/admin")).status, 302);
  await c.login("admin@power.local", "Adm1n-Test-Pass!");
  const dash = await c.req("GET", "/admin");
  assert.match(dash.text, /System health/);
  assert.equal(
    JSON.parse((await c.req("GET", "/admin/health.json")).text).database.driver,
    "sqlite",
  );
  const users = await c.req("GET", "/admin/tables/users");
  assert.match(users.text, /••••••/);
  assert.ok(!users.text.includes("scrypt$"));
  assert.equal(
    (await c.req("GET", "/admin/tables/evil%22%3Bdrop")).status,
    404,
  );
  assert.equal((await c.req("GET", "/admin/tables?conn=nope")).status, 404);
  assert.match(
    (await c.req("GET", "/admin/tables?conn=analytics")).text,
    /analytics/,
  );
  assert.match(
    (await c.req("GET", "/admin/logs")).text,
    /Initial admin user created/,
  );
});

test("registration: XSS escaped, mass-assignment blocked, weak passwords rejected", async () => {
  const c = new Client(base);
  const weak = await register(c, "weak@example.com", "Weak", "password1234");
  assert.equal(weak.loc, "/register");
  assert.equal(await User.findByEmail("weak@example.com"), null);

  const evil = "<script>alert(1)</script>";
  const t = await c.csrf("/register");
  const r = await c.req("POST", "/register", {
    _csrf: t,
    name: evil,
    email: "Bob@Example.com",
    password: STRONG,
    password_confirmation: STRONG,
    role: "admin",
  });
  assert.equal(r.loc, "/dashboard");
  const dash = await c.req("GET", "/dashboard");
  assert.ok(!dash.text.includes(evil));
  assert.match(dash.text, /&lt;script&gt;/);
  assert.equal((await User.findByEmail("bob@example.com")).role, "user");
  assert.equal((await c.req("GET", "/admin")).status, 403);
  // duplicate email differing only by case
  assert.equal(
    (await register(new Client(base), "BOB@example.com")).loc,
    "/register",
  );
});

test("real-browser form posts work (Origin: null / Sec-Fetch-Site) while cross-site posts are still blocked", async () => {
  const email = "admin@power.local",
    password = "Adm1n-Test-Pass!";
  const attempt = async (headers) => {
    const c = new Client(base);
    const t = await c.csrf("/login");
    return {
      c,
      r: await c.req("POST", "/login", { _csrf: t, email, password }, headers),
    };
  };
  // Same-origin <form> POST under Referrer-Policy: no-referrer → browsers send "Origin: null" (this used to be rejected = "cross-site blocked")
  assert.equal(
    (await attempt({ origin: "null", "sec-fetch-site": "same-origin" })).r.loc,
    "/admin",
  );
  assert.equal((await attempt({ origin: "null" })).r.loc, "/admin"); // older browsers: token still enforced
  assert.equal(
    (
      await attempt({
        origin: "http://some-proxy.example",
        "sec-fetch-site": "same-origin",
      })
    ).r.loc,
    "/admin",
  ); // proxy rewrote Host; browser says same-origin
  assert.equal((await attempt({ "sec-fetch-site": "none" })).r.loc, "/admin"); // typed URL / bookmark
  // …while genuinely cross-site requests stay blocked even with a valid token
  assert.equal(
    (
      await attempt({
        "sec-fetch-site": "cross-site",
        origin: "https://evil.example",
      })
    ).r.status,
    403,
  );
  assert.equal(
    (await attempt({ "sec-fetch-site": "same-site" })).r.status,
    403,
  );
  assert.equal(
    (await attempt({ origin: "https://evil.example" })).r.status,
    403,
  );
  // …and the token is still mandatory for browser-looking requests
  const c = new Client(base);
  await c.csrf("/login");
  const noTok = await c.req(
    "POST",
    "/login",
    { email, password },
    { origin: "null", "sec-fetch-site": "same-origin" },
  );
  assert.equal(noTok.status, 403);
  assert.match(noTok.text, /reload the page/);
});

test("/logout is friendly: GET never 404s, POST signs out (browser-style)", async () => {
  const c = new Client(base);
  assert.equal((await c.req("GET", "/logout")).loc, "/login"); // signed out: just go to login
  await c.login(email0, pass0);
  const page = await c.req("GET", "/logout");
  assert.equal(page.status, 200);
  assert.match(page.text, /Sign out\?/);
  const t = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const out = await c.req(
    "POST",
    "/logout",
    { _csrf: t },
    { origin: "null", "sec-fetch-site": "same-origin" },
  );
  assert.equal(out.loc, "/login");
  assert.equal((await c.req("GET", "/dashboard")).loc, "/login");
});

test("SQL injection attempts are inert", async () => {
  const c = new Client(base);
  const r = await c.login("' OR 1=1 --", "' OR '1'='1");
  assert.equal(r.loc, "/login");
  const r2 = await c.login("admin@power.local' --", "x");
  assert.equal(r2.loc, "/login");
  assert.ok((await User.count()) >= 1);
});

test("account lockout after repeated failures (same generic message, correct password refused while locked)", async () => {
  await register(new Client(base), "lock@example.com", "Lock Test");
  const c = new Client(base);
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await c.login("lock@example.com", "wrong-password-" + i)).loc,
      "/login",
    );
  const u = await User.findByEmail("lock@example.com");
  assert.ok(Number(u.locked_until) > Date.now());
  assert.equal((await c.login("lock@example.com", STRONG)).loc, "/login"); // locked: even the right password fails
  await User.update(u.id, { failed_logins: 0, locked_until: null });
  assert.equal((await c.login("lock@example.com", STRONG)).loc, "/dashboard");
});

test("TOTP 2FA: enrol, replay protection, backup codes, step-up on login", async () => {
  const c = new Client(base);
  await register(c, "mfa@example.com", "Mfa Test");
  await c.post("/account/2fa/start", {}, "/account/security");
  const secret = (await c.req("GET", "/account/security")).text.match(
    /Key: <code>([A-Z2-7]+)<\/code>/,
  )[1];
  const step = Math.floor(Date.now() / 30000);
  assert.equal(
    (
      await c.post(
        "/account/2fa/enable",
        { code: "000000" },
        "/account/security",
      )
    ).loc,
    "/account/security",
  ); // wrong code
  const enabled = await c.post(
    "/account/2fa/enable",
    { code: hotp(secret, step) },
    "/account/security",
  );
  assert.equal(enabled.status, 200);
  const backup = enabled.text.match(/[0-9a-f]{5}-[0-9a-f]{5}/g);
  assert.equal(backup.length, 8);
  const row = await User.findByEmail("mfa@example.com");
  assert.ok(
    row.totp_secret.startsWith("v1.") && !row.totp_secret.includes(secret),
  ); // encrypted at rest
  assert.ok(!row.backup_codes.includes(backup[0])); // only hashes stored

  const c2 = new Client(base);
  assert.equal((await c2.login("mfa@example.com", STRONG)).loc, "/login/2fa");
  assert.equal((await c2.req("GET", "/dashboard")).status, 302); // password alone is not a session
  assert.equal(
    (await c2.post("/login/2fa", { code: hotp(secret, step) }, "/login/2fa"))
      .loc,
    "/login/2fa",
  ); // replay of the enrol code
  assert.equal(
    (
      await c2.post(
        "/login/2fa",
        { code: hotp(secret, step + 1) },
        "/login/2fa",
      )
    ).loc,
    "/dashboard",
  );

  const c3 = new Client(base);
  await c3.login("mfa@example.com", STRONG);
  assert.equal(
    (await c3.post("/login/2fa", { code: backup[0] }, "/login/2fa")).loc,
    "/dashboard",
  );
  const c4 = new Client(base);
  await c4.login("mfa@example.com", STRONG);
  assert.equal(
    (await c4.post("/login/2fa", { code: backup[0] }, "/login/2fa")).loc,
    "/login/2fa",
  ); // single use
});

test("password change revokes other sessions; UA-bound cookies are rejected elsewhere", async () => {
  const a = new Client(base),
    b = new Client(base);
  await register(a, "rev@example.com", "Rev Test");
  await b.login("rev@example.com", STRONG);
  assert.equal((await b.req("GET", "/dashboard")).status, 200);

  const stolen = new Client(base, "attacker-browser");
  stolen.jar = { ...b.jar };
  assert.equal((await stolen.req("GET", "/dashboard")).status, 302); // same cookie, different client → rejected

  const NEW = "Correct-Horse-Battery-9";
  const bad = await a.post(
    "/account/password",
    {
      current_password: "nope-nope-nope",
      new_password: NEW,
      new_password_confirmation: NEW,
    },
    "/account/security",
  );
  assert.equal(bad.loc, "/account/security");
  assert.ok(await User.findByEmail("rev@example.com"));
  const ok = await a.post(
    "/account/password",
    {
      current_password: STRONG,
      new_password: NEW,
      new_password_confirmation: NEW,
    },
    "/account/security",
  );
  assert.equal(ok.loc, "/account/security");
  assert.equal((await a.req("GET", "/dashboard")).status, 200); // current device stays signed in
  assert.equal((await b.req("GET", "/dashboard")).status, 302); // other device is signed out
  assert.equal(
    (await new Client(base).login("rev@example.com", NEW)).loc,
    "/dashboard",
  );
});

test("admin: cannot delete the last admin", async () => {
  const c = new Client(base);
  await c.login("admin@power.local", "Adm1n-Test-Pass!");
  const admin = await User.findByEmail("admin@power.local");
  const del = await c.post(
    `/admin/users/${admin.id}`,
    { _method: "DELETE" },
    "/admin/users",
  );
  assert.equal(del.loc, "/admin/users");
  assert.ok(await User.findByEmail("admin@power.local"));
});

test("TOTP matches RFC 6238 vector; encryption round-trips and rejects tampering", async () => {
  assert.equal(hotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 1), "287082");
  assert.equal(
    verifyTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "287082", 0, 59000),
    1,
  );
  const { encrypt, decrypt } = await import("../core/crypto.js");
  const t = encrypt("hello");
  assert.equal(decrypt(t), "hello");
  assert.equal(decrypt(t.slice(0, -2) + "AA"), null);
});

test("template engine: extends, blocks, include, escaping", async () => {
  const { ViewEngine } = await import("../core/view.js");
  const d = path.join(tmp, "v");
  fs.mkdirSync(d);
  fs.writeFileSync(
    path.join(d, "base.html"),
    '[<% block a %>base-a<% endblock %>|<include type="html" path="inc">]',
  );
  fs.writeFileSync(path.join(d, "inc.html"), "inc:{{ x }}");
  fs.writeFileSync(
    path.join(d, "child.html"),
    '<% extends "base" %><% block a %><% super %>+child<% for n, i in list %>{{ n }}{{ i }}<% endfor %><% endblock %>',
  );
  assert.equal(
    new ViewEngine(d).render("child", { x: "<b>", list: ["a", "b"] }),
    "[base-a+childa0b1|inc:&lt;b&gt;]",
  );
  fs.writeFileSync(path.join(d, "raw.html"), "{{{ raw }}}{{ missing.deep }}");
  assert.equal(new ViewEngine(d).render("raw", { raw: "<i>" }), "<i>");
});
