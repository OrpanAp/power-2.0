# P.O.W.E.R. — Progressively Optimized Web Engine for Rendering

Zero-dependency web framework: Node.js ≥ 22.13 (built-ins only: `node:http(s)`, `node:fs`, `node:path`, `node:crypto`, `node:net/tls`, `node:sqlite`) + vanilla JS.

```bash
node bin/power-cli.js serve          # dev server: live reload + auto-restart (migrates + seeds on first boot)
NODE_ENV=production SESSION_SECRET=$(node bin/power-cli.js key:generate | cut -d= -f2) node --disable-warning=ExperimentalWarning app.js
npm test                             # 53 tests (+2 live-DB tests when TEST_PG_URL / TEST_MYSQL_URL are set)
```
First boot prints a one-time admin password (or set `POWER_ADMIN_EMAIL` / `POWER_ADMIN_PASSWORD`). Admin panel: `/admin`.

### View Available CLI Commands

To list all available P.O.W.E.R. CLI commands and their usage, run:

```bash
node bin/power-cli.js help
```

This displays the available commands for project setup, server management, database migrations, environment configuration, user administration, and presentation imports.

## Documentation & demos (built with P.O.W.E.R. itself)
Run the server and open:
* `/` landing page · `/docs` **18 documentation pages** (search, table of contents, copy buttons, syntax highlighting; sources in `docs/*.md`)
* `/demo` interactive demos: security lab (XSS / SQL-injection / validation / password policy), multi-database SQL generation,
  Markdown + slides playground, live SSE stream, routing & middleware trace, error handling.
The docs are tested against the code: every internal link must resolve and every documented CLI command and setting must exist.
To add a page, create `docs/<slug>.md` and list it in `app/docs.js`.

## Environment configuration
Layers (lowest → highest): `.env` → `.env.<mode>` → `.env.local` (skipped in test) → `.env.<mode>.local` → **real process environment**.
`NODE_ENV` may itself live in `.env`. Values support quotes, `export`, multi-line `"…"`, `${VAR}`, `${VAR:-default}`, `\$` and inline `# comments`.
```bash
node bin/power-cli.js env:check [--env=production]   # validate; shows every setting, its source, secrets masked; exit 1 on errors
node bin/power-cli.js env:set APP_NAME="My App"      # writes .env.local (0600) · env:get KEY [--reveal] · env:example
node bin/power-cli.js key:generate --write           # SESSION_SECRET → .env.local
```
* **Typed + validated at boot:** bad `PORT`, missing/short `SESSION_SECRET` in production etc. are all reported together; typos in `.env` files get a "did you mean …?" hint.
* **Secrets from files** (Docker/Kubernetes): `SESSION_SECRET_FILE=/run/secrets/session` (also `DB_URL_FILE`, `DB_<NAME>_URL_FILE`, `POWER_ADMIN_PASSWORD_FILE` …).
* **Templates:** only `PUBLIC_*` variables are exposed → `{{ publicEnv.PUBLIC_ANALYTICS_ID }}`. In code: `import { env } from './config/env.js'` → `env('KEY', d)`, `env.int/bool/list/required`.
* Never commit `.env`, `.env.local`, `.env.*.local` (the generated `.gitignore` covers them).

## `.env` setup and database connection examples

The repository should contain **`.env.example`**, not your private `.env`. Create your local config by copying the template:

```bash
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env`. Edit `.env` and keep only one active `DB_URL` line. The provided default is local SQLite:

```dotenv
DB_URL=sqlite:storage/power.sqlite
```

### Database URL formats

```dotenv
# XAMPP MySQL/MariaDB: root account with an empty password
DB_URL=mysql://<USERNAME>:<PASSWORD>@127.0.0.1:3306/<DATABASE_NAME>

# MySQL with a username and password
DB_URL=mysql://<USERNAME>:<URL_ENCODED_PASSWORD>@127.0.0.1:3306/<DATABASE_NAME>

# MariaDB
DB_URL=mariadb://<USERNAME>:<URL_ENCODED_PASSWORD>@127.0.0.1:3306/<DATABASE_NAME>

# PostgreSQL (either scheme is accepted)
DB_URL=postgres://<USERNAME>:<URL_ENCODED_PASSWORD>@127.0.0.1:5432/<DATABASE_NAME>
DB_URL=postgresql://<USERNAME>:<URL_ENCODED_PASSWORD>@127.0.0.1:5432/<DATABASE_NAME>

# Hosted PostgreSQL with certificate verification
DB_URL=postgres://<USERNAME>:<URL_ENCODED_PASSWORD>@<DB_HOST>:5432/<DATABASE_NAME>?sslmode=verify-full

# Hosted MySQL with TLS required
DB_URL=mysql://<USERNAME>:<URL_ENCODED_PASSWORD>@<DB_HOST>:3306/<DATABASE_NAME>?ssl=true
```

**URL parts:** in `mysql://root:@127.0.0.1:3306/power`, `mysql://` selects the driver, `root` is the username, the empty part after `:` is the password, `127.0.0.1` is the database host, `3306` is the port, and `power` is the database name. Create the database on the server first; a connection URL does not create it automatically.

**Encode special characters** in usernames/passwords before putting them in a URL: `@` → `%40`, `:` → `%3A`, `/` → `%2F`, and `#` → `%23`. Do not commit real credentials. For remote databases, use the TLS option recommended by your database provider; `ssl=true` requires encryption but does not verify the server certificate, while `sslmode=verify-full` enables certificate/host verification.

Optional URL parameters include `pool=5`, `timeout=30000`, `ssl=true`, `sslmode=disable|require|verify-ca|verify-full`, and `sslca=/path/to/ca.pem`. Additional named connections can be configured with variables such as `DB_ANALYTICS_URL=postgres://...`; these do not replace the default `DB_URL`.

### Other environment settings

All recognized settings and their defaults are documented inline in `.env.example`. Common settings include `NODE_ENV`, `APP_NAME`, `HOST`, `PORT`, `SESSION_SECRET`, `PASSWORD_PEPPER`, `SESSION_TTL_HOURS`, `SESSION_ABSOLUTE_HOURS`, `ALLOW_REGISTRATION`, `ALLOWED_HOSTS`, `FORCE_HTTPS`, `TLS_CERT`, `TLS_KEY`, rate limits, and presentation limits.

Validate your configuration with:

```bash
node bin/power-cli.js env:check
node bin/power-cli.js db:check
node bin/power-cli.js db:status
```

For production, set `NODE_ENV=production`, provide a strong `SESSION_SECRET` of at least 32 characters, set `ALLOWED_HOSTS`, configure HTTPS, and use a hosted database with TLS. Do not use local SQLite files or development credentials as your production database configuration without reviewing the deployment requirements.

## Live presentations
Markdown decks stored in the database (any connection), presented live; the audience follows in real time over SSE.
| URL | Who | What |
|---|---|---|
| `/admin/presentations` | admin | create/edit decks — editor with **live preview**, Ctrl/Cmd+S |
| `/present/<slug>` | admin | presenter console: current + next slide, **speaker notes**, timer, viewer count, reaction totals, jump list; ← → Space Home End, `S` start, `Esc` end |
| `/live/<slug>` | public deck: anyone · private: signed-in | audience view: follows the presenter, free browsing + **Return to live**, 👏❤️😮😂👍 reactions, fullscreen, swipe, works on phones |
| `/presentations` | anyone | list of public decks (with LIVE badges) |
Deck format: slides separated by `---`; `Notes:` starts presenter-only notes; optional first line `<!-- class: center dark accent big top -->`;
themes `light | dark | contrast`; headings, lists, tables, quotes, code fences, links, same-origin/`data:` images. Slides scale with `cqw` units (16:9, no JS scaling).
Editing a deck while it is live updates every viewer instantly; deleting it closes their streams. CLI: `presentation:import deck.md --slug=talk --public`.
Security: Markdown is escaped first and only allow-listed URLs become links/images (no raw HTML, no `javascript:`); notes never reach audience endpoints;
control endpoints are admin + CSRF; reactions are token-free but Origin-checked and rate-limited; per-IP/per-deck connection caps
(`PRESENTATION_MAX_CONN_PER_IP`, `PRESENTATION_MAX_VIEWERS`). Live state is in memory (one process); a restart returns decks to "idle" and browsers reconnect automatically.

## Troubleshooting
* **Can't remember the admin login?** `node bin/power-cli.js admin:info` lists admin accounts (and, in development, the password generated at first boot);
  `node bin/power-cli.js user:reset-password [email]` sets a new one (default: first admin) and clears lockouts. In production passwords are never written to disk.
  Every dev start also prints the login URL and admin email. Set your own first-boot credentials with `POWER_ADMIN_EMAIL` / `POWER_ADMIN_PASSWORD` (10+ chars) before the first run.
* **403 "Request blocked" on login/logout:** the CSRF guard rejects a post only when the browser says it is cross-site (`Sec-Fetch-Site`) or `Origin` ≠ `Host`,
  or when the form token is missing/stale (reload the page). Behind a proxy that rewrites `Host`, modern browsers still work; check the `system_logs` entry
  "Request rejected by CSRF protection" for the exact reason. Don't open the app through an embedding iframe (frame-ancestors is `none`).
* **Cookies not sticking in production over http:** production uses `__Host-` + `Secure` cookies and HSTS — serve over HTTPS (or `TLS_CERT`/`TLS_KEY`).

## Databases (SQLite · PostgreSQL · MySQL/MariaDB · multiple at once)
```
DB_URL=sqlite:storage/power.sqlite                       # default connection
DB_URL=postgres://user:pass@host:5432/app?sslmode=verify-full
DB_URL=mysql://user:pass@host:3306/app?ssl=true
DB_ANALYTICS_URL=postgres://...                          # any number of extra named connections
```
Options: `sslmode=disable|require|verify-ca|verify-full` (or `ssl=true`), `sslca=/path/ca.pem`, `pool=5`, `timeout=30000`.
All drivers are implemented in this repo on top of `node:net`/`node:tls` (PostgreSQL v3 protocol with SCRAM-SHA-256; MySQL protocol with
`mysql_native_password` / `caching_sha2_password`, server-side prepared statements). Queries always use `?` placeholders and bound parameters.

```js
import { manager } from './core/database.js';
const analytics = manager.connection('analytics');
class Event extends Model { static table = 'events'; static connection = 'analytics'; }
await db.transaction(async (tx) => { await tx.run('UPDATE ...', [..]); });   // use `tx`, never the global db, inside
```
Migrations are portable: `db.schema.createTable('posts', (t) => { t.id(); t.string('title', 120).notNull(); t.timestamps(); })`.
Extra connections keep migrations in `database/migrations/<name>/` (`node bin/power-cli.js db:migrate --connection=analytics`).
**Caveat:** the PostgreSQL and MySQL drivers are verified against RFC vectors and fake protocol servers only. Run
`TEST_PG_URL=… TEST_MYSQL_URL=… npm test` against your real servers before relying on them. MySQL DDL is not transactional.

## Security model (defence in depth — no framework can promise "completely secure")
| Layer | What is implemented |
|---|---|
| Passwords | scrypt (N=2¹⁵), per-hash salt, optional `PASSWORD_PEPPER`, rehash-on-login, 10+ chars, blocklist + context checks |
| Brute force | per-IP route limits, global limit, **per-account lockout with exponential back-off**, identical error for every failure, timing equalisation |
| 2FA | TOTP (RFC 6238) with replay protection, 8 hashed single-use backup codes, secrets AES-256-GCM encrypted at rest; `REQUIRE_ADMIN_2FA=1` |
| Sessions | server-side, HMAC-keyed ids, rotated on login/password/2FA change, idle **and** absolute timeouts, bound to User-Agent, revoke-all on password change, `__Host-` cookie in production |
| CSRF / XSS | per-session token + Origin check; auto-escaped templates; strict CSP (no inline JS/CSS), nosniff, COOP/CORP/COEP, Referrer-Policy |
| Transport | HSTS, `FORCE_HTTPS`, native TLS (`TLS_CERT`/`TLS_KEY`), `ALLOWED_HOSTS` host-header allow-list |
| Input | size limits, depth/param-count limits, prototype-pollution keys dropped, control chars stripped, mass-assignment whitelists |
| SQL | prepared statements only, validated identifiers, `LIKE` escaping; admin table browser masks secrets and protects `users`/`migrations` |
| Files | traversal + symlink-escape protection, dotfiles blocked |
| Ops | audit trail in `system_logs` (secrets redacted), `Cache-Control: no-store` on dynamic pages, minimal `/health` |
Not covered: DDoS protection, WAF, secret management, multi-process rate limiting (use a reverse proxy / shared store), QR codes for 2FA (key shown as text).

## Layout
```
app.js                  boot + middleware pipeline
bin/power-cli.js        CLI (init, serve, make:*, db:*, user:reset-password, key:generate)
config/config.js        .env loader + settings
core/                   router, server, http helpers, view engine, session, csrf, validator, security,
                        database, model, migrator, livereload, health, logger, auth, static, body parser
app/controllers|models|routes|views|auth.js
database/migrations/    sortable <timestamp>_name.js with up(db)/down(db);  database/seed.js
public/                 static assets (CSS/JS; no inline scripts – strict CSP)
tests/                  node:test smoke + security tests
```

## Templates
`<% extends "layouts/main" %>` · `<% block x %>…<% endblock %>` (`<% super %>` = parent default; blocks can't be nested) ·
`{{ expr }}` escaped · `{{{ expr }}}` raw · `<include type="html" path="partials/x">` (`type="text"` inserts the file escaped) ·
`<% if/elseif/else/endif %>` `<% unless %>` `<% for item[, i] in list %>…<% endfor %>`.
Helpers: `fmtDate fmtBytes fmtUptime truncate json entries selected checked cap`; forms use `{{{ csrfField }}}`.
Expressions are developer-authored code (evaluated with `new Function`) — never build templates from user input.

## Routing
```js
app.get('/users/:id', auth.requireAuth, (req, res) => res.json({ id: req.params.id }));
app.group('/admin', [auth.requireRole('admin')], (r) => r.get('/', handler));
app.use((err, req, res, next) => {...});          // error handler (4 args)
```
HTML forms can use `<input type="hidden" name="_method" value="DELETE">`.

## Security notes
scrypt password hashing · server-side sessions (HMAC-keyed ids, regenerated on login) · CSRF token + Origin check ·
strict CSP & security headers · input sanitization (control chars, prototype-pollution keys) + auto-escaped output ·
prepared statements only, identifiers whitelisted · login rate limiting · RBAC (`admin`, `user`).
Limits: no multipart uploads, single-process in-memory rate limiter, SSE live reload is dev-only.
