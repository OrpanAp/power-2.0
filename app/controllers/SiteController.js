import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "../../core/database.js";
import { Connection } from "../../core/db/index.js";
import { Blueprint } from "../../core/db/schema.js";
import { toPgSql } from "../../core/db/drivers/postgres.js";
import { Validator } from "../../core/validator.js";
import { HttpError } from "../../core/errors.js";
import { escapeHtml, stripTags } from "../../core/security.js";
import { checkPassword } from "../../core/passwordPolicy.js";
import { renderMarkdown, parseDeck } from "../../core/markdown.js";
import { highlight } from "../../core/highlight.js";
import { config } from "../../config/config.js";
import { GROUPS, ORDER, loadDoc, neighbors, searchDocs } from "../docs.js";

/* ---- facts shown on the landing page, computed from the real project (not hard-coded) ---- */
let facts = null;
function projectFacts(app) {
  if (facts) return facts;
  let deps = 0,
    lines = 0,
    files = 0;
  try {
    deps = Object.keys(
      JSON.parse(
        fs.readFileSync(path.join(config.root, "package.json"), "utf8"),
      ).dependencies || {},
    ).length;
  } catch {
    /* keep 0 */
  }
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".js")) {
        files++;
        lines += fs.readFileSync(p, "utf8").split("\n").length;
      }
    }
  };
  try {
    walk(path.join(config.root, "core"));
  } catch {
    /* ignore */
  }
  facts = {
    deps,
    coreFiles: files,
    coreLines: lines,
    docs: ORDER.length,
    routes: app.routeList().length,
    node: process.version,
  };
  return facts;
}

const SHOWCASE = [
  {
    id: "route",
    label: "Route",
    lang: "js",
    code: `app.group('/admin', [auth.requireRole('admin')], (r) => {
  r.get('/users', async (req, res) => {
    const page = await User.paginate(req.query.page, 15);
    res.render('admin/users', { users: page.data });
  });
  r.delete('/users/:id', AdminController.usersDestroy);
});`,
  },
  {
    id: "view",
    label: "Template",
    lang: "html",
    code: `<% extends "layouts/main" %>
<% block content %>
  <h1>Hello, {{ user.name }}</h1>
  <% for post in posts %>
    <article>{{ post.title }}</article>
  <% endfor %>
<% endblock %>`,
  },
  {
    id: "model",
    label: "Model",
    lang: "js",
    code: `class Post extends Model {
  static table = 'posts';
  static connection = 'analytics';   // any configured database
  static fillable = ['title', 'body'];
}
const post = await Post.create({ title: 'Hi' });
await db.transaction(async (tx) => { /* atomic work */ });`,
  },
  {
    id: "migrate",
    label: "Migration",
    lang: "js",
    code: `export async function up(db) {
  await db.schema.createTable('posts', (t) => {
    t.id();
    t.string('title', 120).notNull();
    t.timestamps();
  });   // same file runs on SQLite, PostgreSQL, MySQL
}`,
  },
  {
    id: "validate",
    label: "Validation",
    lang: "js",
    code: `const v = await Validator.make(req.body, {
  email: 'required|email|unique:users,email',
  password: ['required', passwordRule],
});
if (v.fails()) return res.invalid(v.errors, req.body, '/register');`,
  },
].map((s) => ({ ...s, html: highlight(s.code, s.lang) }));

export class SiteController {
  static home(req, res) {
    res.render("home", {
      title: "Zero-dependency web framework for Node.js",
      description:
        "P.O.W.E.R. is a secure, real-time web framework built only on Node.js built-ins: router, templates, SQLite/PostgreSQL/MySQL, auth, 2FA, live presentations and an admin panel.",
      facts: projectFacts(req.app),
      showcase: SHOWCASE,
      live: req.app.hub.statusOf("welcome"),
      groups: GROUPS,
    });
  }

  /* ---------------- Docs ---------------- */
  static docsHome(req, res) {
    res.redirect("/docs/introduction");
  }
  static docsPage(req, res) {
    const doc = loadDoc(req.params.slug);
    if (!doc) throw new HttpError(404, "Documentation page not found");
    res.render("docs/page", {
      title: `${doc.title} - Docs`,
      description: doc.text.slice(0, 160),
      doc,
      groups: GROUPS,
      slug: doc.slug,
      ...neighbors(doc.slug),
      q: "",
    });
  }
  static docsSearch(req, res) {
    const { q, results } = searchDocs(req.query.q);
    res.render("docs/search", {
      title: "Search the docs",
      groups: GROUPS,
      slug: "",
      q,
      results,
    });
  }

  /* ---------------- Demos ---------------- */
  static demoIndex(req, res) {
    res.render("demo/index", {
      title: "Interactive demos",
      live: req.app.hub.statusOf("welcome"),
    });
  }
  static demoSecurity(req, res) {
    res.render("demo/security", { title: "Security demo" });
  }
  static demoMarkdown(req, res) {
    res.render("demo/markdown", {
      title: "Markdown & slides playground",
      sample:
        "# Hello, P.O.W.E.R.\n\nWrite **Markdown** on the left.\n\n- Safe by default\n- `<script>` is escaped\n- [javascript: links](javascript:alert(1)) are removed\n\n```js\nconst answer = 42; // highlighted on the server\n```\n\nNotes: slide mode treats this as speaker notes\n\n---\n\n## Second slide\n\n> Slides are separated by three dashes.\n",
    });
  }
  static demoLive(req, res) {
    res.render("demo/live", {
      title: "Live stream demo",
      live: req.app.hub.statusOf("welcome"),
    });
  }

  /** Real SQL generated by the real Connection/Blueprint code for each dialect (captured, never executed). */
  static async demoSchema(req, res) {
    const migration = `await db.schema.createTable('posts', (t) => {
  t.id();
  t.string('title', 120).notNull();
  t.text('body');
  t.integer('is_public').notNull().default(0);
  t.bigInteger('author_id');
  t.timestamps();
  t.foreign('author_id', 'users', 'id', 'SET NULL');
  t.index('author_id');
});
await db.insert('posts', { title: 'Hi', author_id: 1 });
await db.upsert('kv', { k: 'theme', v: 'dark' }, ['k']);
await db.all('SELECT * FROM posts WHERE id = ? LIMIT ?', [1, 10]);`;
    const dialects = [];
    for (const [dialect, label] of [
      ["sqlite", "SQLite"],
      ["postgres", "PostgreSQL"],
      ["mysql", "MySQL / MariaDB"],
    ]) {
      const sent = [];
      const conn = new Connection("demo", dialect, {
        query: async (sql) => {
          sent.push(sql);
          return { rows: [{ id: 1 }], changes: 1, lastId: 1 };
        },
        exec: async () => {},
      });
      const t = new Blueprint(conn, "posts");
      t.id();
      t.string("title", 120).notNull();
      t.text("body");
      t.integer("is_public").notNull().default(0);
      t.bigInteger("author_id");
      t.timestamps();
      t.foreign("author_id", "users", "id", "SET NULL");
      t.index("author_id");
      const ddl = t.createSql().join(";\n\n") + ";";
      await conn.insert("posts", { title: "Hi", author_id: 1 });
      await conn.upsert("kv", { k: "theme", v: "dark" }, ["k"]);
      await conn.all("SELECT * FROM posts WHERE id = ? LIMIT ?", [1, 10]);
      const wire = dialect === "postgres" ? sent.map(toPgSql) : sent; // what is actually sent to the server
      dialects.push({
        dialect,
        label,
        ddl: highlight(ddl, "sql"),
        queries: highlight(wire.join(";\n") + ";", "sql"),
        note: {
          sqlite:
            "Embedded node:sqlite. Single connection, async mutex, WAL mode.",
          postgres:
            "Wire protocol v3, SCRAM-SHA-256, extended query protocol: ? becomes $1, $2 and values are sent separately.",
          mysql:
            "Binary prepared statements (COM_STMT_PREPARE/EXECUTE), caching_sha2 or native auth, STRICT mode.",
        }[dialect],
      });
    }
    res.render("demo/schema", {
      title: "Multi-database demo",
      migration: highlight(migration, "js"),
      dialects,
    });
  }

  /** Routing demo: params, query, and the middleware chain that ran (each hop adds a trace entry). */
  static trace(name) {
    return (req, res, next) => {
      (req.trace ||= []).push({
        name,
        ms: Number(performance.now().toFixed(2)),
      });
      next();
    };
  }
  static routing(req, res) {
    if (!/^[\w-]{1,40}$/.test(req.params.id))
      throw new HttpError(
        400,
        'The :id parameter may contain 1 to 40 letters, digits, "-" or "_".',
      );
    const data = {
      method: req.method,
      path: req.path,
      pattern: req.route,
      params: { ...req.params },
      query: { ...req.query },
      trace: req.trace || [],
    };
    if (req.query.format === "json") return res.json(data);
    res.render("demo/routing", {
      title: "Routing demo",
      data,
      paramsJson: JSON.stringify(data.params, null, 2),
      queryJson: JSON.stringify(data.query, null, 2),
    });
  }
  static teapot() {
    throw new HttpError(
      418,
      "I'm a teapot. This page was produced by the framework's error handler.",
    );
  }

  /* ---------------- Demo APIs (pure functions: no state, origin-checked, rate-limited) ---------------- */
  static async apiEscape(req, res) {
    const text = String(req.body.text ?? "").slice(0, 500);
    const sql = "SELECT COUNT(*) AS c FROM users WHERE email = ?";
    const row = await db.get(sql, [text.toLowerCase()]); // really executed, with the payload as a bound parameter
    res.json({
      escaped: escapeHtml(text),
      stripped: stripTags(text),
      markdown: renderMarkdown(text),
      sql,
      params: [text],
      matches: Number(row.c),
    });
  }
  static async apiValidate(req, res) {
    const v = await Validator.make(req.body, {
      name: "required|string|min:2|max:40",
      email: "required|email|max:100",
      age: "nullable|integer|between:13,120",
      role: "required|in:admin,user",
      website: "nullable|url",
    });
    res.json({
      ok: v.passes(),
      errors: v.errors,
      validated: v.passes() ? v.validated() : null,
    });
  }
  static apiPassword(req, res) {
    const pw = String(req.body.password ?? "");
    const msg = pw
      ? checkPassword(pw, { email: String(req.body.email || "") })
      : "Type a password to check it.";
    res.json({
      ok: !msg,
      message: msg || "Acceptable under the policy.",
      length: pw.length,
    });
  }
  static apiMarkdown(req, res) {
    const md = String(req.body.markdown ?? "");
    if (Buffer.byteLength(md) > 20 * 1024)
      throw new HttpError(413, "The playground accepts up to 20 KB.");
    if (req.body.mode === "slides") {
      const deck = parseDeck(md, { maxSlides: 20, maxBytes: 20 * 1024 });
      return res.json({
        mode: "slides",
        slides: deck.slides.map((s) => ({
          html: s.html,
          notes: s.notes,
          classes: s.classes,
        })),
      });
    }
    res.json({ mode: "doc", html: renderMarkdown(md, 0, { highlight: true }) });
  }

  /** Metrics for the live-stream demo (broadcast once a second to every connected viewer). */
  static metrics(app) {
    const m = process.memoryUsage();
    return {
      t: Date.now(),
      uptime: Math.round(process.uptime()),
      rss: m.rss,
      heap: m.heapUsed,
      load: Number(os.loadavg()[0].toFixed(2)),
      requests: app.stats.requests,
      viewers: app.hub.statusOf("__ticker").viewers,
    };
  }
  static stream(req, res) {
    req.app.hub.join(req, res, "__ticker");
  }
}
