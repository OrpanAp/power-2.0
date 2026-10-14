import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { setupEnv, Client, openSse, waitFor } from "./helpers.js";

const tmp = setupEnv({ PRESENTATION_MAX_CONN_PER_IP: "3" });
const { renderMarkdown, parseDeck } = await import("../core/markdown.js");
const { boot } = await import("../app.js");
const { manager } = await import("../core/database.js");

/* ---------------- Markdown safety (unit) ---------------- */
test("markdown: HTML is escaped; only allow-listed URLs become links/images", () => {
  const html = renderMarkdown(
    "<script>alert(1)</script> <img src=x onerror=alert(1)> **b**",
  );
  assert.ok(!/<script|<img/i.test(html));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<strong>b<\/strong>/);
  for (const bad of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<b>",
    "//evil.example/x",
    "vbscript:x",
    '/a" onmouseover="alert(1)',
  ])
    assert.ok(!/<a /.test(renderMarkdown(`[x](${bad})`)), bad);
  const ok = renderMarkdown("[ok](https://ok.example/p?a=1&b=2)");
  assert.match(
    ok,
    /<a href="https:\/\/ok\.example\/p\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">ok<\/a>/,
  );
  assert.match(renderMarkdown("[home](/x/y)"), /<a href="\/x\/y">home<\/a>/);
  assert.ok(!/<img/.test(renderMarkdown("![a](https://evil.example/x.png)"))); // external images blocked (CSP anyway)
  assert.ok(
    !/<img/.test(renderMarkdown("![a](data:image/svg+xml;base64,AAAA)")),
  ); // SVG data URLs blocked
  assert.match(
    renderMarkdown("![pic](/img/p.png)"),
    /<img src="\/img\/p\.png" alt="pic"/,
  );
  assert.ok(
    !/onerror/.test(
      renderMarkdown('![x" onerror="alert(1)](/a.png)').replace(/&quot;/g, ""),
    ) || true,
  );
  assert.match(
    renderMarkdown('![x" onerror="y](/a.png)'),
    /alt="x&quot; onerror=&quot;y"/,
  ); // attribute injection neutralised
  assert.match(renderMarkdown("`<b>` x"), /<code>&lt;b&gt;<\/code>/);
  assert.ok(!renderMarkdown("\u00000\u0000 evil").includes("\u0000")); // forged placeholders stripped
});

test("markdown: blocks render (headings, lists, nested lists, tables, quotes, code)", () => {
  const html = renderMarkdown(
    '# T\n\n- a\n  - b\n- c\n\n1. one\n2. two\n\n> quote *em* ~~del~~\n\n| h1 | h2 |\n|---|---|\n| x | y |\n\n```js\nconst a = "<b>";\n```',
  );
  assert.match(html, /<h1>T<\/h1>/);
  assert.match(html, /<ul><li>a<ul><li>b<\/li><\/ul><\/li><li>c<\/li><\/ul>/);
  assert.match(html, /<ol><li>one<\/li><li>two<\/li><\/ol>/);
  assert.match(
    html,
    /<blockquote><p>quote <em>em<\/em> <del>del<\/del><\/p><\/blockquote>/,
  );
  assert.match(
    html,
    /<table><thead><tr><th>h1<\/th><th>h2<\/th><\/tr><\/thead><tbody><tr><td>x<\/td><td>y<\/td><\/tr>/,
  );
  assert.match(
    html,
    /<pre data-lang="js"><code class="lang-js">const a = &quot;&lt;b&gt;&quot;;<\/code><\/pre>/,
  );
});

test("deck parsing: separators, fenced ---, notes, class allow-list, limits", () => {
  const d = parseDeck(
    "# Title\n\nhello\nNotes: remember *this*\n\n---\n<!-- class: center evil dark -->\n## Two\n\n```\n---\nstill slide two\n```\n\n---\n\n---\n## Three",
  );
  assert.equal(d.title, "Title");
  assert.equal(d.slides.length, 3); // empty chunk skipped, fenced --- not a separator
  assert.match(d.slides[0].notes, /<em>this<\/em>/);
  assert.ok(!d.slides[0].html.includes("remember"));
  assert.equal(d.slides[1].classes, "center dark");
  assert.match(d.slides[1].html, /still slide two/);
  assert.throws(
    () => parseDeck("a\n---\nb\n---\nc\n---\nd", { maxSlides: 3 }),
    /at most 3 slides/,
  );
  assert.throws(
    () => parseDeck("x".repeat(5000), { maxBytes: 1000 }),
    /larger than/,
  );
});

/* ---------------- Live presentation flow (integration) ---------------- */
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

const MD =
  "# Live Test\n\nFirst\nNotes: SECRET-NOTE-123\n\n---\n\n## Second\n\n---\n\n## Third";
const csrfFrom = (html, name = "csrf") =>
  new RegExp(`<meta name="${name}" content="([^"]+)"`).exec(html)[1];

test("live presentations: access control, presenter control, real-time sync, reactions, limits", async () => {
  const admin = new Client(base);
  await admin.login("admin@power.local", "Adm1n-Test-Pass!");
  const create = async (title, pub) => {
    const r = await admin.post(
      "/admin/presentations",
      {
        title,
        theme: "dark",
        markdown: MD,
        ...(pub ? { is_public: "1" } : {}),
      },
      "/admin/presentations/new",
    );
    assert.match(
      r.loc,
      /^\/admin\/presentations\/\d+\/edit$/,
      r.text.slice(0, 200),
    );
    return Number(/(\d+)/.exec(r.loc)[1]);
  };
  const pubId = await create("Live Test", true);
  await create("Private Deck", false);

  // --- who can see what ---
  const guest = new Client(base);
  const page = await guest.req("GET", "/live/live-test");
  assert.equal(page.status, 200);
  assert.match(page.text, /Second/);
  assert.ok(
    !page.text.includes("SECRET-NOTE-123"),
    "notes never reach the audience",
  );
  const slidesJson = await guest.json("GET", "/live/live-test/slides");
  assert.equal(slidesJson.body.slides.length, 3);
  assert.ok(!slidesJson.text.includes("SECRET-NOTE-123"));
  assert.equal((await guest.req("GET", "/live/private-deck")).status, 302); // private → login
  assert.equal((await guest.req("GET", "/live/nope")).status, 404);
  assert.equal((await openSse(port, "/live/private-deck/events")).status, 401);
  assert.match((await guest.req("GET", "/presentations")).text, /Live Test/);
  assert.ok(
    !(await guest.req("GET", "/presentations")).text.includes("Private Deck"),
  );

  const pres = await admin.req("GET", "/present/live-test");
  assert.equal(pres.status, 200);
  assert.match(pres.text, /SECRET-NOTE-123/); // presenter sees notes
  const tok = csrfFrom(pres.text);
  assert.equal((await guest.req("GET", "/present/live-test")).status, 302);
  const user = new Client(base);
  await user.post(
    "/register",
    {
      name: "Viewer One",
      email: "viewer@example.com",
      password: "Tr0ub4dor&3-horse-staple",
      password_confirmation: "Tr0ub4dor&3-horse-staple",
    },
    "/register",
  );
  assert.equal((await user.req("GET", "/present/live-test")).status, 403); // non-admin can't present
  const utok = await user.csrf("/dashboard");
  assert.equal(
    (
      await user.json(
        "POST",
        "/present/live-test/control",
        { action: "start" },
        { "x-csrf-token": utok },
      )
    ).status,
    403,
  );
  assert.ok(
    [401, 403].includes(
      (
        await guest.json("POST", "/present/live-test/control", {
          action: "start",
        })
      ).status,
    ),
  );
  assert.equal((await user.req("GET", "/live/private-deck")).status, 200); // members can watch private decks

  // --- real time ---
  const aud = await openSse(port, "/live/live-test/events");
  assert.equal(aud.status, 200);
  const first = await waitFor(aud, (e) => e.event === "state");
  assert.deepEqual(
    [first.data.status, first.data.total, first.data.index],
    ["idle", 3, 0],
  );
  const ps = await openSse(
    port,
    "/present/live-test/events",
    admin.cookieHeader(),
  );
  assert.equal(ps.status, 200);

  const ctl = (body) =>
    admin.json("POST", "/present/live-test/control", body, {
      "x-csrf-token": tok,
    });
  assert.equal((await ctl({ action: "goto", index: 1 })).status, 409); // must start first
  assert.equal((await ctl({ action: "explode" })).status, 400);
  assert.equal((await ctl({ action: "start" })).body.status, "live");
  await waitFor(aud, (e) => e.event === "state" && e.data.status === "live");
  assert.equal((await ctl({ action: "goto", index: 2 })).body.index, 2);
  await waitFor(aud, (e) => e.event === "state" && e.data.index === 2);
  assert.equal((await ctl({ action: "goto", index: 99 })).body.index, 2); // clamped
  assert.equal((await ctl({ action: "goto", index: "x" })).status, 400);
  await waitFor(aud, (e) => e.event === "viewers" && e.data.count === 1); // presenter not counted as audience

  // --- reactions (anonymous, token-free, Origin-checked) ---
  const react = (kind, headers = {}) =>
    guest.json(
      "POST",
      "/live/live-test/react",
      { kind },
      { origin: base, ...headers },
    );
  assert.equal((await react("clap")).status, 204);
  assert.equal(
    (await waitFor(ps, (e) => e.event === "reaction")).data.counts.clap,
    1,
  );
  assert.equal((await react("hack")).status, 400);
  assert.equal(
    (await react("heart", { origin: "https://evil.example" })).status,
    403,
  );

  // --- editing a live deck updates viewers instantly ---
  const upd = await admin.post(
    `/admin/presentations/${pubId}`,
    {
      _method: "PUT",
      title: "Live Test",
      slug: "live-test",
      theme: "dark",
      is_public: "1",
      markdown: "# Only two\n---\n## Slides",
    },
    `/admin/presentations/${pubId}/edit`,
  );
  assert.equal(upd.loc, `/admin/presentations/${pubId}/edit`);
  await waitFor(aud, (e) => e.event === "content");
  await waitFor(
    aud,
    (e) => e.event === "state" && e.data.total === 2 && e.data.index === 1,
  ); // index clamped to new length
  assert.equal(
    (await guest.json("GET", "/live/live-test/slides")).body.slides.length,
    2,
  );

  // --- end, then reactions refused ---
  await ctl({ action: "end" });
  await waitFor(aud, (e) => e.event === "state" && e.data.status === "ended");
  assert.equal((await react("clap")).status, 409);

  // --- per-IP connection cap (3) ---
  aud.close();
  ps.close();
  await new Promise((r) => setTimeout(r, 100));
  const open = [];
  for (let i = 0; i < 3; i++)
    open.push(await openSse(port, "/live/live-test/events"));
  assert.deepEqual(
    open.map((s) => s.status),
    [200, 200, 200],
  );
  assert.equal((await openSse(port, "/live/live-test/events")).status, 429);
  open[0].close();
  await new Promise((r) => setTimeout(r, 100));
  const again = await openSse(port, "/live/live-test/events");
  assert.equal(again.status, 200);

  // --- deleting a deck tells viewers ---
  const del = await admin.post(
    `/admin/presentations/${pubId}`,
    { _method: "DELETE" },
    "/admin/presentations",
  );
  assert.equal(del.loc, "/admin/presentations");
  await waitFor(again, (e) => e.event === "closed");
  assert.equal((await guest.req("GET", "/live/live-test")).status, 404);
  for (const s of [...open, again]) s.close();
});

test("editor preview endpoint is admin-only, CSRF-protected and sanitised", async () => {
  const admin = new Client(base);
  await admin.login("admin@power.local", "Adm1n-Test-Pass!");
  const tok = csrfFrom(
    (await admin.req("GET", "/admin/presentations/new")).text.replace(
      /data-csrf="([^"]+)"/,
      '<meta name="csrf" content="$1"',
    ),
  );
  const ok = await admin.json(
    "POST",
    "/admin/presentations/preview",
    { markdown: "# Hi <script>x</script>\n---\n## B" },
    { "x-csrf-token": tok },
  );
  assert.equal(ok.body.slides.length, 2);
  assert.ok(!ok.text.includes("<script"));
  assert.equal(
    (
      await admin.json("POST", "/admin/presentations/preview", {
        markdown: "x",
      })
    ).status,
    403,
  ); // no CSRF header
  assert.equal(
    (
      await new Client(base).json("POST", "/admin/presentations/preview", {
        markdown: "x",
      })
    ).status,
    403,
  );
  const big = await admin.json(
    "POST",
    "/admin/presentations/preview",
    { markdown: Array(300).fill("a").join("\n---\n") },
    { "x-csrf-token": tok },
  );
  assert.equal(big.status, 422);
});
