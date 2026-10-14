import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { setupEnv, Client, openSse, waitFor } from "./helpers.js";

const tmp = setupEnv({ RATE_LIMIT_PER_MINUTE: "100000" });
const { boot } = await import("../app.js");
const { manager, db } = await import("../core/database.js");
const { GROUPS, ORDER, loadDoc, searchDocs } = await import("../app/docs.js");
const { renderDoc } = await import("../core/markdown.js");
const { SCHEMA } = await import("../config/env.js");

let app, port, base;
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

const ROOT = path.resolve(import.meta.dirname, "..");
const decode = (s) => s.replace(/&amp;/g, "&");

/* ---------------- Documentation ---------------- */
test("every documented page exists, has a title, unique heading ids and a TOC", () => {
  assert.ok(ORDER.length >= 15);
  for (const { slug } of ORDER) {
    assert.ok(
      fs.existsSync(path.join(ROOT, "docs", `${slug}.md`)),
      `docs/${slug}.md is missing`,
    );
    const d = loadDoc(slug);
    assert.ok(d.title, `${slug} has no # title`);
    const ids = [...d.html.matchAll(/<h[1-4] id="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(
      new Set(ids).size,
      ids.length,
      `${slug}: duplicate heading ids`,
    );
    assert.ok(d.toc.length >= 1, `${slug}: no sections`);
  }
  const files = fs
    .readdirSync(path.join(ROOT, "docs"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3));
  assert.deepEqual(
    files.sort(),
    ORDER.map((p) => p.slug).sort(),
    "every docs/*.md must be listed in the manifest (and vice versa)",
  );
});

test("docs routes: pages, redirect, 404, traversal, search (XSS-safe)", async () => {
  const c = new Client(base);
  assert.equal((await c.req("GET", "/docs")).loc, "/docs/introduction");
  for (const { slug, title } of ORDER) {
    const r = await c.req("GET", `/docs/${slug}`);
    assert.equal(r.status, 200, slug);
    assert.ok(r.text.includes("<title>"));
  }
  assert.equal((await c.req("GET", "/docs/nope")).status, 404);
  assert.equal(
    (await c.req("GET", "/docs/..%2f..%2fconfig%2fconfig")).status,
    404,
  );
  assert.equal((await c.req("GET", "/docs/introduction.md")).status, 404);
  const hit = await c.req("GET", "/docs/search?q=csrf");
  assert.match(hit.text, /href="\/docs\/security"/);
  assert.match(hit.text, /<mark>/i);
  const xss = await c.req(
    "GET",
    "/docs/search?q=" + encodeURIComponent("<script>alert(1)</script>"),
  );
  assert.equal(xss.status, 200);
  assert.ok(!xss.text.includes("<script>alert(1)"));
  assert.match(
    (await c.req("GET", "/docs/search?q=a")).text,
    /at least two characters/,
  );
  assert.equal(searchDocs("scrypt").results[0].slug.length > 0, true);
});

test("code blocks are highlighted but always escaped", () => {
  const d = renderDoc(
    '# T\n\n```js\nconst x = "<img src=x onerror=alert(1)>"; // <script>\n```\n\n```html\n<div onclick="x()">{{ a }}</div>\n```',
  );
  assert.ok(
    !/<img|<script|<div/i.test(
      d.html.replace(/<span class="tok-[a-z]">/g, "").replace(/<\/span>/g, ""),
    ),
  );
  assert.match(d.html, /tok-k/);
  assert.match(d.html, /&lt;script&gt;/);
});

test("every internal link in the docs, landing page and demo index resolves", async () => {
  const c = new Client(base);
  const pages = ["/", "/demo", ...ORDER.map((p) => `/docs/${p.slug}`)];
  const links = new Map(); // target -> source
  for (const p of pages) {
    const html = (await c.req("GET", p)).text;
    for (const m of html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
      const t = decode(m[1]);
      if (!links.has(t)) links.set(t, p);
    }
  }
  assert.ok(links.size >= 30, `only ${links.size} links found`);
  const ids = new Map(); // slug -> heading ids (for /docs/x#anchor links)
  for (const [target, from] of links) {
    const [pathPart, hash] = target.split("#"),
      noQuery = pathPart.split("?")[0];
    if (/^\/(css|js|img)\//.test(noQuery) || noQuery === "/favicon.svg") {
      assert.ok(
        fs.existsSync(path.join(ROOT, "public", noQuery)),
        `${target} (from ${from}) not found in public/`,
      );
      continue;
    }
    if (noQuery === "/__power/livereload.js") continue;
    const r = await c.req("GET", pathPart);
    assert.ok(
      [200, 302, 418].includes(r.status),
      `broken link ${target} on ${from} -> HTTP ${r.status}`,
    );
    if (hash && noQuery.startsWith("/docs/")) {
      const slug = noQuery.slice(6);
      if (!ids.has(slug))
        ids.set(
          slug,
          new Set(
            [...loadDoc(slug).html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]),
          ),
        );
      assert.ok(ids.get(slug).has(hash), `broken anchor ${target} on ${from}`);
    }
  }
});

test("docs match reality: every documented CLI command and env variable exists", () => {
  const help = execFileSync(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      path.join(ROOT, "bin/power-cli.js"),
      "help",
    ],
    { encoding: "utf8", env: { ...process.env, NODE_ENV: "test" } },
  );
  const cli = fs.readFileSync(path.join(ROOT, "docs/cli.md"), "utf8");
  const cmds = [...cli.matchAll(/^\| `([a-z]+(?::[a-z0-9-]+)?)[ `]/gm)]
    .map((m) => m[1])
    .filter((c) => !["npm"].includes(c));
  assert.ok(cmds.length >= 18, "parsed commands: " + cmds.join(","));
  for (const c of cmds)
    assert.ok(
      help.includes(c),
      `documented command "${c}" is missing from the CLI help`,
    );
  const cfg = fs.readFileSync(path.join(ROOT, "docs/configuration.md"), "utf8");
  const vars = [...cfg.matchAll(/^\| `([A-Z][A-Z0-9_]*)`/gm)]
    .map((m) => m[1])
    .filter((v) => v !== "DB_");
  assert.ok(vars.length >= 20);
  for (const v of vars)
    assert.ok(
      v in SCHEMA || /^DB_<NAME>/.test(v),
      `documented variable ${v} is not in the settings schema`,
    );
  for (const k of Object.keys(SCHEMA))
    if (!["DB_PATH"].includes(k))
      assert.ok(cfg.includes(k), `setting ${k} is not documented`);
});

/* ---------------- CSP compliance of every new page ---------------- */
test("pages contain no inline scripts, inline handlers or style attributes (strict CSP)", async () => {
  const c = new Client(base);
  const pages = [
    "/",
    "/docs/introduction",
    "/docs/security",
    "/docs/search?q=session",
    "/demo",
    "/demo/security",
    "/demo/schema",
    "/demo/markdown",
    "/demo/live",
    "/demo/routing/9?a=b",
    "/presentations",
    "/live/welcome",
  ];
  for (const p of pages) {
    const r = await c.req("GET", p);
    assert.equal(r.status, 200, p);
    assert.ok(
      !/<script(?![^>]*\bsrc=)[^>]*>/i.test(r.text),
      `inline <script> on ${p}`,
    );
    assert.ok(
      !/\son[a-z]+\s*=\s*["']/i.test(
        r.text.replace(/<pre[\s\S]*?<\/pre>/g, ""),
      ),
      `inline event handler on ${p}`,
    );
    assert.ok(
      !/\sstyle\s*=\s*["']/i.test(r.text.replace(/<pre[\s\S]*?<\/pre>/g, "")),
      `style attribute on ${p}`,
    );
    assert.match(r.headers.get("content-security-policy"), /script-src 'self'/);
  }
});

/* ---------------- Landing page ---------------- */
test("landing page shows real, computed facts", async () => {
  const c = new Client(base);
  const r = await c.req("GET", "/");
  assert.equal(r.status, 200);
  assert.match(r.text, /<b>0<\/b><span>npm dependencies/); // from package.json
  assert.match(r.text, /<b>(\d+)<\/b><span>framework files/);
  assert.match(r.text, /documentation pages/);
  assert.match(r.text, /href="\/docs\/quick-start"/);
  assert.match(r.text, /href="\/demo"/);
  assert.match(r.text, /<img src="\/img\/request-flow\.svg"/);
  for (const id of ["route", "view", "model", "migrate", "validate"])
    assert.match(r.text, new RegExp(`id="tab-${id}"`));
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
      .dependencies &&
      Object.keys(
        JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
          .dependencies,
      ).length,
    0,
  );
  for (const f of [
    "/robots.txt",
    "/favicon.svg",
    "/img/architecture.svg",
    "/img/request-flow.svg",
  ])
    assert.equal((await c.req("GET", f)).status, 200, f);
  assert.match(
    (await c.req("GET", "/img/architecture.svg")).headers.get("content-type"),
    /image\/svg\+xml/,
  );
});

/* ---------------- Demo pages & endpoints ---------------- */
const api = (c, url, body, headers = {}) =>
  c.json("POST", url, body, { origin: base, ...headers });

test("demo: hostile input is neutralised and SQL is parameterised (and really executed)", async () => {
  const c = new Client(base);
  const x = await api(c, "/demo/api/escape", {
    text: "<script>alert(1)</script> [x](javascript:alert(1))",
  });
  assert.equal(x.status, 200);
  assert.match(x.body.escaped, /&lt;script&gt;/);
  assert.ok(
    !x.body.markdown.includes("<script") &&
      !x.body.markdown.includes("javascript:"),
  );
  const inj = await api(c, "/demo/api/escape", {
    text: "' OR 1=1; DROP TABLE users; --",
  });
  assert.equal(inj.body.matches, 0);
  assert.match(inj.body.sql, /email = \?/);
  assert.deepEqual(inj.body.params, ["' OR 1=1; DROP TABLE users; --"]);
  assert.ok(
    (await db.tables()).includes("users"),
    "users table must still exist",
  );
  assert.equal(
    (await api(c, "/demo/api/escape", { text: "x".repeat(2000) })).body
      .params[0].length,
    500,
  ); // input capped
});

test("demo: validation and password endpoints", async () => {
  const c = new Client(base);
  const bad = await api(c, "/demo/api/validate", {
    name: "A",
    email: "nope",
    age: "12",
    role: "root",
    website: "javascript:alert(1)",
  });
  assert.deepEqual(Object.keys(bad.body.errors).sort(), [
    "age",
    "email",
    "name",
    "role",
    "website",
  ]);
  const good = await api(c, "/demo/api/validate", {
    name: "Ada",
    email: "ada@example.com",
    age: "36",
    role: "user",
    website: "https://example.com",
  });
  assert.equal(good.body.ok, true);
  assert.equal(good.body.validated.age, 36);
  assert.equal(
    (await api(c, "/demo/api/password", { password: "password1234" })).body.ok,
    false,
  );
  assert.equal(
    (await api(c, "/demo/api/password", { password: "aaaaaaaaaaaa" })).body.ok,
    false,
  );
  assert.equal(
    (
      await api(c, "/demo/api/password", {
        password: "correct-horse-battery-9",
      })
    ).body.ok,
    true,
  );
});

test("demo: markdown playground (doc + slides), size and slide limits, cross-site posts blocked", async () => {
  const c = new Client(base);
  const doc = await api(c, "/demo/api/markdown", {
    markdown: "# T\n```js\nconst a = 1;\n```\n<script>x</script>",
    mode: "doc",
  });
  assert.match(doc.body.html, /tok-k/);
  assert.ok(!doc.body.html.includes("<script"));
  const slides = await api(c, "/demo/api/markdown", {
    markdown: "# A\nNotes: n\n---\n## B",
    mode: "slides",
  });
  assert.equal(slides.body.slides.length, 2);
  assert.match(slides.body.slides[0].notes, /n/);
  assert.equal(
    (await api(c, "/demo/api/markdown", { markdown: "x".repeat(21 * 1024) }))
      .status,
    413,
  );
  assert.equal(
    (
      await api(c, "/demo/api/markdown", {
        markdown: Array(25).fill("a").join("\n---\n"),
        mode: "slides",
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await c.json(
        "POST",
        "/demo/api/escape",
        { text: "x" },
        { origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await c.json(
        "POST",
        "/demo/api/escape",
        { text: "x" },
        { "sec-fetch-site": "cross-site" },
      )
    ).status,
    403,
  );
});

test("demo: multi-database page shows real generated SQL for each dialect", async () => {
  const html = (await new Client(base).req("GET", "/demo/schema")).text;
  const t = html
    .replace(/<[^>]+>/g, "")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&"); // text as the reader sees it (highlight spans removed)
  for (const s of [
    "BIGSERIAL PRIMARY KEY",
    "AUTO_INCREMENT",
    "AUTOINCREMENT",
    "ON DUPLICATE KEY UPDATE",
    "ON CONFLICT",
    "$1",
    "ENGINE=InnoDB",
  ])
    assert.ok(t.includes(s), `missing ${s}`);
  assert.match(t, /LIMIT \$2/); // PostgreSQL wire form
});

test("demo: routing shows params, query and the middleware chain; errors are handled", async () => {
  const c = new Client(base);
  const j = await c.json(
    "GET",
    "/demo/routing/42?color=blue&lang=en&format=json",
  );
  assert.equal(j.body.pattern, "/demo/routing/:id");
  assert.equal(j.body.params.id, "42");
  assert.equal(j.body.query.color, "blue");
  assert.deepEqual(
    j.body.trace.map((t) => t.name),
    ["request-logger", "parameter-check"],
  );
  const page = await c.req("GET", "/demo/routing/42?color=blue");
  assert.match(page.text, /request-logger/);
  assert.match(page.text, /&quot;color&quot;: &quot;blue&quot;/);
  assert.equal((await c.req("GET", "/demo/routing/bad%20id")).status, 400);
  const x = await c.req("GET", "/demo/routing/%3Cscript%3E");
  assert.equal(x.status, 400);
  assert.ok(!x.text.includes("<script>"));
  const tea = await c.req("GET", "/demo/teapot");
  assert.equal(tea.status, 418);
  assert.match(tea.text, /teapot/);
});

test("demo: live stream pushes metrics over SSE", async () => {
  const sse = await openSse(port, "/demo/stream");
  assert.equal(sse.status, 200);
  const tick = await waitFor(sse, (e) => e.event === "tick", 4000);
  for (const k of ["t", "uptime", "rss", "heap", "load", "requests", "viewers"])
    assert.ok(k in tick.data, k);
  assert.ok(tick.data.rss > 1e6 && tick.data.viewers >= 1);
  sse.close();
});

test("admin presentation editor loads the presentation stylesheet (regression)", async () => {
  const a = new Client(base);
  await a.login("admin@power.local", "Adm1n-Test-Pass!");
  assert.match(
    (await a.req("GET", "/admin/presentations/new")).text,
    /\/css\/presentation\.css/,
  );
});
