<div align="center">

<img src="assets/power-banner.svg" alt="P.O.W.E.R. 2.0 — Node.js web framework banner" width="100%">
<p><strong>⚡ Progressively Optimized Web Engine for Rendering</strong></p>
<p>Build server-rendered web applications with a framework powered by Node.js built-ins.</p>

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.13-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Zero runtime dependencies](https://img.shields.io/badge/runtime%20dependencies-0-2563eb)](package.json)
[![License](https://img.shields.io/badge/license-see%20LICENSE-64748b)](LICENSE)
[![GitHub issues](https://img.shields.io/github/issues/OrpanAp/power-2.0?color=8b5cf6)](https://github.com/OrpanAp/power-2.0/issues)

[🚀 Get started](#-get-started) · [✨ Features](#-what-you-get) · [📚 Documentation](#-documentation--demos) · [🐛 Report a bug](https://github.com/OrpanAp/power-2.0/issues)

</div>

---

> **Project status:** Active development. P.O.W.E.R. 2.0 is a developing framework. Review the limitations and test database integrations with your actual database server before using it for production workloads.

**What is P.O.W.E.R.?**

P.O.W.E.R. is a **zero-runtime-dependency Node.js web framework** designed to bring the building blocks of a web application into one project: routing, MVC-style organization, server-rendered views, authentication, security controls, database tools, and a command-line interface.

Instead of starting with a large stack of runtime packages, P.O.W.E.R. uses Node.js built-ins and gives you a structured foundation to explore, learn, and build on.

| Area | Features |
|:--|:--|
| 🧱 **Application foundation** | HTTP routing and middleware · Controllers, models, and views · Layouts and reusable template parts · Input parsing and validation · Database migrations and seed data |
| 🔐 **Authentication & security** | Password hashing and server-side sessions · Roles and administrator tools · Optional TOTP two-factor authentication · CSRF and Origin checks · Security headers, rate limits, and SQL protections |
| 🗄️ **Database tools** | SQLite for local development · Connection URL formats for PostgreSQL, MySQL, and MariaDB · Named database connections · Database status and configuration diagnostics |
| 🎤 **Built-in experiences** | Command-line developer tools · Documentation and interactive demos · Development live reload · Live Markdown presentations with audience updates over SSE |

<a id="-get-started"></a>

**✨ Get started**

**Requirements**

- **Node.js 22.13.0 or newer**
- npm (included with Node.js)
- Git, or download the repository as a ZIP

**1. Clone the repository**

```bash
git clone https://github.com/OrpanAp/power-2.0.git
cd power-2.0
```

**2. Create your environment file**

**Windows PowerShell**

```powershell
Copy-Item .env.example .env
```

**macOS, Linux, or Git Bash**

```bash
cp .env.example .env
```

The example configuration uses a local SQLite database, so you can start exploring without setting up a separate database server.

**3. Start P.O.W.E.R.**

```bash
node bin/power-cli.js serve
```

Open **http://127.0.0.1:3000** in your browser.

On first boot, the application may display initial administrator login details. Keep them private and change the password after signing in.

**4. Explore the app**

| Open this path | What you'll find |
|:--|:--|
| `/` | Application landing page |
| `/docs` | Framework documentation |
| `/demo` | Interactive examples |
| `/admin` | Administrator dashboard |
| `/presentations` | Public presentation decks |

Need help with commands? Run:

```bash
node bin/power-cli.js help
```

<a id="-what-you-get"></a>

**🧰 What you get**

**A familiar application structure**

P.O.W.E.R. organizes application code into routes, controllers, models, and views. The framework also includes middleware, template layouts and blocks, escaped output, static assets, logging, health checks, migrations, and seed data.

A simplified route example:

```js
app.get('/users/:id', auth.requireAuth, (req, res) => {
  res.json({ id: req.params.id });
});
```

Adapt examples to the APIs available in the version checked out from your repository.

**🗝️ Security-focused building blocks**

P.O.W.E.R. includes controls such as:

- Password hashing with scrypt and per-hash salts
- Server-side sessions, session rotation, and session expiry
- Role-based access control
- Optional TOTP two-factor authentication and single-use backup codes
- CSRF tokens, Origin checks, and login throttling
- Escaped template output and security headers
- Prepared SQL statements and identifier validation
- Request-size limits and path-traversal protections

These features are useful building blocks, **not a guarantee that an application is secure**. Review the code and deployment configuration for your threat model.

**⚙️ Database configuration**

SQLite is the default for local development. Set `DB_URL` in your `.env` file to configure a database connection.

```dotenv
**SQLite**
DB_URL=sqlite:storage/power.sqlite

**MySQL**
DB_URL=mysql://USER:URL_ENCODED_PASSWORD@127.0.0.1:3306/DATABASE

**MariaDB**
DB_URL=mariadb://USER:URL_ENCODED_PASSWORD@127.0.0.1:3306/DATABASE

**PostgreSQL**
DB_URL=postgres://USER:URL_ENCODED_PASSWORD@127.0.0.1:5432/DATABASE
```

Before connecting to a remote database:

1. Create the database on the database server.
2. URL-encode special characters in credentials.
3. Configure TLS according to your database provider's instructions.
4. Run the connection checks and integration tests against the database server/version you plan to use.

The PostgreSQL and MySQL drivers should be verified against your actual server before production use.

**🪩 Live Markdown presentations**

Create Markdown slide decks and present them to an audience with real-time updates over Server-Sent Events (SSE).

| Path | Purpose |
|:--|:--|
| `/admin/presentations` | Create and edit decks |
| `/present/:slug` | Presenter controls, notes, and timer |
| `/live/:slug` | Audience view |
| `/presentations` | Browse public decks |

Presentation state is stored in memory for a single running process. It returns to idle after a restart, so account for this behavior when deploying.

**⌨️ Useful CLI commands**

| Command | Purpose |
|:--|:--|
| `node bin/power-cli.js help` | Show available commands |
| `node bin/power-cli.js env:check` | Validate environment configuration |
| `node bin/power-cli.js db:check` | Check database configuration/connectivity |
| `node bin/power-cli.js db:status` | Show database status |
| `node bin/power-cli.js key:generate` | Generate a secret key |
| `npm test` | Run the test suite |

Use the CLI help output as the source of truth for your checked-out version.

<a id="-documentation--demos"></a>

**📚 Documentation & demos**

Start the app and visit **`/docs`** for documentation or **`/demo`** for interactive examples. The demos cover areas such as routing and middleware, security checks, SQL generation, Markdown slides, streaming, and error handling.

Documentation source files live in `docs/`. To add a page, create a Markdown file and register it in `app/docs.js`.

**🚀 Before deploying**

Use this checklist before exposing an application to the internet:

- [ ] Set `NODE_ENV=production`.
- [ ] Configure a strong `SESSION_SECRET` (at least 32 characters).
- [ ] Set `ALLOWED_HOSTS` to the hostnames your application should accept.
- [ ] Use HTTPS and secure production cookie settings.
- [ ] Configure a production database, TLS, and backups.
- [ ] Set and protect administrator credentials.
- [ ] Review proxy settings, rate limits, logs, and environment variables.
- [ ] Run the test suite and database integration tests.
- [ ] Account for in-memory presentation state and rate limiting before scaling to multiple processes.

Never commit `.env` files or real credentials.

**🧪 Tests**

Run the standard test suite:

```bash
npm test
```

Optional database integration tests can be enabled with `TEST_PG_URL` and/or `TEST_MYSQL_URL`. Use dedicated test databases only; integration tests may create or modify database objects.

**🗂️ Project layout**

```text
app.js                  Application entry point
bin/power-cli.js        Command-line interface
config/                 Configuration and environment loading
core/                   Router, sessions, security, database, ORM, and utilities
app/controllers/        Request controllers
app/models/             Data models
app/routes/             Route definitions
app/views/              Server-rendered templates
database/migrations/    Database migrations
docs/                   Documentation pages
public/                 Static assets
tests/                  Automated tests
```

**⚠️ Current limitations**

- Live presentation state is in memory and intended for a single process.
- The built-in rate limiter is in memory and does not coordinate between processes.
- Development live reload is not a production feature.
- Multipart file uploads are not currently provided by the framework.
- Test PostgreSQL and MySQL integrations with your actual server before relying on them in production.
- You still need deployment-level protections such as backups, monitoring, secure secret management, and appropriate network controls.

**🤝 Contributing**

Found a bug or have an idea? [Open an issue](https://github.com/OrpanAp/power-2.0/issues) with reproduction steps, expected behavior, and actual behavior. Contributions should include or update tests where practical, especially for security-sensitive changes.

**📄 License**

See the repository's [LICENSE file](LICENSE) for the terms that apply to this project.

---

<div align="center">

**P.O.W.E.R. 2.0** · Progressively Optimized Web Engine for Rendering

<sub>Built with Node.js · Open to issues, feedback, and contributions</sub>

</div>
