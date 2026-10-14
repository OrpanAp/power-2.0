#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [, , cmd, ...rest] = process.argv;
const args = rest.filter((a) => !a.startsWith("-"));
const flags = Object.fromEntries(
  rest
    .filter((a) => a.startsWith("-"))
    .map((a) => {
      const [k, v] = a.replace(/^-+/, "").split("=");
      return [k, v ?? true];
    }),
);

const c = {
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  d: (s) => `\x1b[90m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};
const die = (m) => {
  console.error(c.r("✗ " + m));
  process.exit(1);
};

const pascal = (s) =>
  s
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, x) => (x || "").toUpperCase())
    .replace(/^./, (x) => x.toUpperCase());
const snake = (s) =>
  pascal(s)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
const plural = (w) =>
  /[^aeiou]y$/.test(w)
    ? w.slice(0, -1) + "ies"
    : /(s|x|z|ch|sh)$/.test(w)
      ? w + "es"
      : w + "s";
const stamp = () => new Date().toISOString().replace(/\D/g, "").slice(0, 14);

function writeNew(file, content) {
  if (fs.existsSync(file) && !flags.force)
    die(
      `${path.relative(process.cwd(), file)} already exists (use --force to overwrite)`,
    );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log(c.g("✓ created ") + path.relative(process.cwd(), file));
}

function controllerSource(name, resource) {
  const view = snake(name);
  const body = resource
    ? ["index", "create", "store", "show", "edit", "update", "destroy"]
        .map(
          (m) =>
            `  static ${["store", "update", "destroy"].includes(m) ? "async " : ""}${m}(req, res) {\n` +
            (["store", "update", "destroy"].includes(m)
              ? `    // TODO: validate with Validator.make(req.body, {...}) and persist\n    res.redirect('/${plural(view)}');\n`
              : `    res.render('${plural(view)}/${m}', { title: '${pascal(name)} ${m}' });\n`) +
            "  }",
        )
        .join("\n\n")
    : `  static index(req, res) {\n    res.render('${plural(view)}/index', { title: '${pascal(name)}' });\n  }`;
  return `import { Validator } from '../../core/validator.js';\n\nexport class ${pascal(name)}Controller {\n${body}\n}\n`;
}
function modelSource(name) {
  return `import { Model } from '../../core/model.js';\n\nexport class ${name} extends Model {\n  static table = '${plural(snake(name))}';\n  static fillable = [];   // mass-assignable columns\n  static hidden = [];     // removed by ${name}.serialize()\n}\n`;
}
function migrationSource(table) {
  return `// Portable across SQLite, PostgreSQL and MySQL — use db.schema.* (db is transaction-bound).
export async function up(db) {
  await db.schema.createTable('${table}', (t) => {
    t.id();
    // t.string('name', 120).notNull();
    t.timestamps();
  });
}

export async function down(db) {
  await db.schema.dropTable('${table}');
}
`;
}

const COPY = [
  "app",
  "bin",
  "config",
  "core",
  "database",
  "docs",
  "public",
  "tests",
  "app.js",
  "package.json",
  "README.md",
];
function init() {
  const dest = path.resolve(args[0] || ".");
  if (dest !== ROOT) {
    for (const item of COPY) {
      const src = path.join(ROOT, item);
      if (fs.existsSync(src))
        fs.cpSync(src, path.join(dest, item), {
          recursive: true,
          filter: (s) => !s.endsWith(".sqlite"),
        });
    }
  }
  for (const d of [
    "app/controllers",
    "app/models",
    "app/routes",
    "app/views",
    "app/middleware",
    "database/migrations",
    "public/css",
    "public/js",
    "storage",
    "tests",
  ])
    fs.mkdirSync(path.join(dest, d), { recursive: true });
  const envExample = [
    "NODE_ENV=development",
    "PORT=3000",
    "HOST=127.0.0.1",
    "APP_NAME=P.O.W.E.R.",
    "SESSION_SECRET=",
    "# Databases: sqlite:path | postgres://user:pass@host:5432/db?sslmode=verify-full | mysql://user:pass@host:3306/db?ssl=true",
    "DB_URL=sqlite:storage/power.sqlite",
    "# DB_ANALYTICS_URL=postgres://...   (extra named connection; migrations in database/migrations/analytics/)",
    "POWER_ADMIN_EMAIL=admin@power.local",
    "# POWER_ADMIN_PASSWORD=   (random one is printed on first boot if unset)",
    "ALLOW_REGISTRATION=1",
    "# REQUIRE_ADMIN_2FA=1",
    "# ALLOWED_HOSTS=example.com,www.example.com",
    "# FORCE_HTTPS=1",
    "# TLS_CERT=/path/cert.pem",
    "# TLS_KEY=/path/key.pem",
    "# PASSWORD_PEPPER=   (optional server-side secret mixed into password hashes; changing it later requires password resets)",
    "",
  ].join("\n");
  const w = (f, t) => {
    const p = path.join(dest, f);
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, t);
      console.log(c.g("✓ created ") + f);
    }
  };
  w(".env.example", envExample);
  w(
    ".env",
    envExample.replace(
      "SESSION_SECRET=",
      "SESSION_SECRET=" + crypto.randomBytes(32).toString("hex"),
    ),
  );
  w(
    ".gitignore",
    "node_modules\n.env\n.env.local\n.env.*.local\nstorage/*.sqlite*\nstorage/.dev-secret\n",
  );
  console.log(
    c.b("\nP.O.W.E.R. project ready in ") +
      dest +
      "\nNext: " +
      (dest === process.cwd()
        ? ""
        : `cd ${path.relative(process.cwd(), dest)} && `) +
      "node bin/power-cli.js serve",
  );
}

async function withDb(fn) {
  const { manager } = await import("../core/database.js");
  const { Migrator } = await import("../core/migrator.js");
  const name =
    typeof flags.connection === "string" ? flags.connection : "default";
  const dir =
    name === "default"
      ? path.join(ROOT, "database/migrations")
      : path.join(ROOT, "database/migrations", name);
  try {
    await fn({
      manager,
      migrator: new Migrator(manager.connection(name), dir),
      name,
    });
  } finally {
    await manager.closeAll();
  }
}

function serve() {
  const prod = !!flags.prod;
  const env = {
    ...process.env,
    NODE_ENV: prod ? "production" : process.env.NODE_ENV || "development",
  };
  if (flags.port) env.PORT = String(flags.port);
  if (flags.host) env.HOST = String(flags.host);
  const run = () =>
    spawn(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", path.join(ROOT, "app.js")],
      { stdio: "inherit", env, cwd: ROOT },
    );
  let child = run();
  if (prod || flags["no-watch"]) {
    child.on("exit", (code) => process.exit(code ?? 0));
    for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
    return;
  }

  // Dev supervisor: restart the server on backend changes (views/public are handled by in-page live reload).
  let timer,
    restarting = false;
  const restart = (why) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      restarting = true;
      console.log(c.d(`↻ ${why} changed — restarting`));
      child.once("exit", () => {
        child = run();
        bindExit();
        restarting = false;
      });
      child.kill("SIGTERM");
    }, 120);
  };
  const bindExit = () =>
    child.on("exit", (code) => {
      if (!restarting) {
        console.log(c.d(`server exited (${code}); waiting for changes…`));
      }
    });
  bindExit();
  for (const d of [
    "app/controllers",
    "app/models",
    "app/routes",
    "app/auth.js",
    "core",
    "config",
    "database",
    "app.js",
    ".env",
  ]) {
    const p = path.join(ROOT, d);
    if (!fs.existsSync(p)) continue;
    try {
      fs.watch(
        p,
        { recursive: true },
        (_e, f) => f && !String(f).endsWith(".sqlite") && restart(`${d}/${f}`),
      );
    } catch {
      /* unsupported */
    }
  }
  for (const s of ["SIGINT", "SIGTERM"])
    process.on(s, () => {
      child.kill(s);
      setTimeout(() => process.exit(0), 300);
    });
}

const commands = {
  init,
  serve,
  "make:controller"() {
    const raw = args[0];
    if (!raw) die("Usage: make:controller <Name> [--resource]");
    const name = pascal(raw.replace(/Controller$/i, ""));
    writeNew(
      path.join(ROOT, "app/controllers", `${name}Controller.js`),
      controllerSource(name, !!flags.resource),
    );
  },
  "make:model"() {
    const raw = args[0];
    if (!raw) die("Usage: make:model <Name> [-m]");
    const name = pascal(raw);
    writeNew(path.join(ROOT, "app/models", `${name}.js`), modelSource(name));
    if (flags.m || flags.migration)
      commands["make:migration"](`create_${plural(snake(name))}_table`);
  },
  "make:migration"(nameArg) {
    const name = nameArg || args[0];
    if (!name) die("Usage: make:migration <name>");
    const m = snake(name).match(/^create_(.+)_table$/);
    writeNew(
      path.join(ROOT, "database/migrations", `${stamp()}_${snake(name)}.js`),
      m
        ? migrationSource(m[1])
        : "export async function up(db) {\n  db.exec(``);\n}\n\nexport async function down(db) {\n  db.exec(``);\n}\n",
    );
  },
  async "db:migrate"() {
    await withDb(async ({ migrator }) => {
      const r = await migrator.migrate();
      console.log(
        r.length
          ? r.map((n) => c.g("✓ migrated ") + n).join("\n")
          : c.d("Nothing to migrate."),
      );
    });
  },
  async "db:rollback"() {
    await withDb(async ({ migrator }) => {
      const r = await migrator.rollback();
      console.log(
        r.length
          ? r.map((n) => c.g("✓ rolled back ") + n).join("\n")
          : c.d("Nothing to roll back."),
      );
    });
  },
  async "db:status"() {
    await withDb(async ({ migrator }) => {
      for (const m of await migrator.status())
        console.log(
          `${m.ran ? c.g("ran    ") : c.d("pending")} ${m.name}${m.batch ? c.d(` (batch ${m.batch})`) : ""}`,
        );
    });
  },
  async "db:seed"() {
    await withDb(async () => {
      const { seed } = await import("../database/seed.js");
      await seed();
    });
  },
  async "admin:info"() {
    await withDb(async () => {
      const { User } = await import("../app/models/User.js");
      const admins = await User.all({ role: "admin" }, { orderBy: "id" });
      if (!admins.length)
        return console.log(
          c.r("No admin account exists yet.") +
            " Start the server once (it creates one), or run: node bin/power-cli.js db:seed",
        );
      console.log(c.b("Admin accounts\n"));
      for (const a of admins) {
        const flagsOut = [
          a.is_active ? c.g("active") : c.r("disabled"),
          a.totp_enabled ? "2FA on" : "2FA off",
          Number(a.locked_until || 0) > Date.now() ? c.r("LOCKED") : null,
          a.last_login_at
            ? `last sign-in ${a.last_login_at}`
            : "never signed in",
        ].filter(Boolean);
        console.log(`  ${a.email}   ${c.d(flagsOut.join(" · "))}`);
      }
      const f = path.join(ROOT, "storage/.admin-credentials");
      if (fs.existsSync(f))
        console.log(
          c.b(
            "\nGenerated at first boot (development only, may be outdated):\n",
          ) +
            fs.readFileSync(f, "utf8").replace(/^/gm, "  ") +
            c.d(
              "  Delete storage/.admin-credentials after changing the password.",
            ),
        );
      else
        console.log(
          c.d("\nPasswords are stored hashed and cannot be displayed."),
        );
      console.log(
        c.b("\nCan't sign in?") +
          "  node bin/power-cli.js user:reset-password" +
          c.d(
            "   (resets the first admin; or pass an email) — also clears lockouts",
          ),
      );
    });
  },
  async "user:reset-password"() {
    await withDb(async () => {
      const { User } = await import("../app/models/User.js");
      const { hashPassword, randomPassword } =
        await import("../core/security.js");
      const u = args[0]
        ? await User.findByEmail(args[0])
        : await User.first({ role: "admin" });
      if (!u)
        die(
          args[0]
            ? `No user with email ${args[0]}`
            : "No admin account exists yet",
        );
      const pw = randomPassword(20);
      await User.update(u.id, {
        password_hash: await hashPassword(pw),
        failed_logins: 0,
        locked_until: null,
        password_changed_at: new Date().toISOString(),
      });
      const { db } = await import("../core/database.js");
      await db.run("DELETE FROM sessions WHERE user_id = ?", [u.id]);
      fs.rmSync(path.join(ROOT, "storage/.admin-credentials"), { force: true });
      console.log(
        c.g("✓ password reset for ") +
          u.email +
          "\n  new password: " +
          pw +
          c.d("\n  (shown once — all sessions were signed out)"),
      );
    });
  },
  async "user:disable-2fa"() {
    const email = args[0];
    if (!email) die("Usage: user:disable-2fa <email>");
    await withDb(async () => {
      const { User } = await import("../app/models/User.js");
      const u = await User.findByEmail(email);
      if (!u) die(`No user with email ${email}`);
      await User.update(u.id, {
        totp_enabled: 0,
        totp_secret: null,
        totp_last_step: null,
        backup_codes: null,
      });
      console.log(c.g("✓ 2FA disabled for ") + u.email);
    });
  },
  async "db:check"() {
    await withDb(async ({ manager }) => {
      for (const n of manager.names()) {
        const cn = manager.connection(n);
        console.log(
          `${(await cn.ping()) ? c.g("up  ") : c.r("down")} ${n} (${cn.dialect})`,
        );
      }
    });
  },
  "key:generate"() {
    const secret = crypto.randomBytes(32).toString("hex");
    if (!flags.write) return console.log("SESSION_SECRET=" + secret);
    import("../config/env.js").then(({ setEnvVar }) => {
      setEnvVar(path.join(ROOT, ".env.local"), "SESSION_SECRET", secret);
      console.log(
        c.g("✓ wrote SESSION_SECRET to .env.local") +
          c.d(
            " (mode 0600; rotating it signs everyone out and invalidates stored 2FA secrets)",
          ),
      );
    });
  },
  async "env:check"() {
    const { describeEnv } = await import("../config/env.js");
    const d = describeEnv({
      root: ROOT,
      mode: typeof flags.env === "string" ? flags.env : undefined,
    });
    console.log(
      c.b(`Environment: ${d.mode}`) +
        c.d(
          "   (layers: .env < .env.<mode> < .env.local < .env.<mode>.local < process env)\n",
        ),
    );
    const w = Math.max(...d.rows.map((r) => r.key.length));
    for (const r of d.rows)
      console.log(
        `${r.key.padEnd(w)}  ${(r.value || c.d("—")).toString().padEnd(34)} ${c.d(r.source)}`,
      );
    for (const x of d.warnings) console.log(c.d("\n⚠ ") + x);
    for (const x of d.errors) console.log(c.r("\n✗ ") + x);
    console.log(
      d.errors.length
        ? c.r(
            `\n${d.errors.length} problem(s) — the server will refuse to start.`,
          )
        : c.g("\n✓ configuration is valid"),
    );
    if (d.errors.length) process.exit(1);
  },
  async "env:get"() {
    const key = args[0];
    if (!key) die("Usage: env:get <KEY> [--reveal]");
    const { loadEnvFiles, SCHEMA } = await import("../config/env.js");
    const env = { ...process.env };
    loadEnvFiles({ root: ROOT, env });
    const v = env[key];
    if (v === undefined) die(`${key} is not set`);
    console.log(
      SCHEMA[key]?.secret && !flags.reveal
        ? c.d("(secret — use --reveal to print)")
        : v,
    );
  },
  async "env:set"() {
    const { setEnvVar } = await import("../config/env.js");
    let [key, value] = args;
    if (key && key.includes("=")) {
      const i = key.indexOf("=");
      value = key.slice(i + 1);
      key = key.slice(0, i);
    }
    if (!key || value === undefined)
      die("Usage: env:set KEY=VALUE [--file=.env.local]");
    const file = path.join(
      ROOT,
      typeof flags.file === "string" ? path.basename(flags.file) : ".env.local",
    );
    if (!/^\.env(\.[\w-]+)*$/.test(path.basename(file)))
      die("--file must be an .env file name");
    setEnvVar(file, key, value);
    console.log(c.g("✓ set ") + key + c.d(` in ${path.basename(file)}`));
  },
  async "env:example"() {
    const { exampleFile } = await import("../config/env.js");
    fs.writeFileSync(path.join(ROOT, ".env.example"), exampleFile());
    console.log(c.g("✓ wrote .env.example"));
  },
  async "presentation:import"() {
    const file = args[0];
    if (!file || !fs.existsSync(file))
      die(
        'Usage: presentation:import <deck.md> [--slug=my-talk] [--title="My talk"] [--theme=light|dark|contrast] [--public]',
      );
    await withDb(async () => {
      const { Presentation } = await import("../app/models/Presentation.js");
      const { parseDeck } = await import("../core/markdown.js");
      const { config } = await import("../config/config.js");
      const { User } = await import("../app/models/User.js");
      const md = fs.readFileSync(file, "utf8");
      const deck = parseDeck(md, config.presentations);
      const title =
        typeof flags.title === "string"
          ? flags.title
          : deck.title || path.basename(file, ".md");
      const slug =
        typeof flags.slug === "string"
          ? flags.slug
          : Presentation.slugify(title);
      if (await Presentation.findBySlug(slug))
        die(`A presentation with slug "${slug}" already exists`);
      const theme = Presentation.THEMES.includes(flags.theme)
        ? flags.theme
        : "light";
      const admin = await User.first({ role: "admin" });
      await Presentation.create({
        slug,
        title,
        markdown: md,
        theme,
        is_public: flags.public ? 1 : 0,
        created_by: admin?.id ?? null,
      });
      console.log(
        c.g("✓ imported ") +
          `${deck.slides.length} slides → /live/${slug}  (present at /present/${slug})`,
      );
    });
  },
  help() {
    console.log(`${c.b("P.O.W.E.R. CLI")}  — node bin/power-cli.js <command>

  init [dir]                    Scaffold a project (folders, .env with a fresh SESSION_SECRET)
  serve [--port=3000] [--prod]  Start the server (dev: live reload + auto-restart)
  make:controller <Name> [--resource]   Generate app/controllers/<Name>Controller.js
  make:model <Name> [-m]        Generate app/models/<Name>.js (-m also creates a migration)
  make:migration <name>         Generate a timestamped migration
  db:migrate | db:rollback | db:status | db:seed   (--connection=<name> for extra databases)
  db:check                      Ping every configured connection
  admin:info                    List admin accounts (and the first-boot password in development)
  user:reset-password [email]   New random password for that user (default: first admin); clears lockout, revokes sessions
  user:disable-2fa <email>      Remove a user's two-factor enrolment
  key:generate [--write]        Print a random SESSION_SECRET (--write stores it in .env.local)
  env:check [--env=production]  Validate configuration, show every value (secrets masked) and where it came from
  env:get <KEY> | env:set KEY=VALUE [--file=.env.local] | env:example
  presentation:import <deck.md> [--slug= --title= --theme= --public]   Import a Markdown deck`);
  },
};

const fn = commands[cmd || "help"];
if (!fn) die(`Unknown command "${cmd}". Run: node bin/power-cli.js help`);
await fn();
