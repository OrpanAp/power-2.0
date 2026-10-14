# P.O.W.E.R. 2.0
### Progressively Optimized Web Engine for Rendering

**A zero-dependency Node.js web framework for server-rendered applications, with authentication, security controls, database tools, and real-time Markdown presentations built in.**

[Repository](https://github.com/OrpanAp/power-2.0) · [Issues & bug reports](https://github.com/OrpanAp/power-2.0/issues)

> **Status:** Active development. Review the known limitations and database-driver verification notes before using P.O.W.E.R. for production workloads.

## Why P.O.W.E.R.?

P.O.W.E.R. is built with Node.js native modules and vanilla JavaScript rather than a third-party runtime framework. It brings common application features together so you can explore and build with routing, MVC structure, sessions, database migrations, environment configuration, and administration tools in one project.

- **No runtime package dependencies** — uses Node.js built-ins.
- **MVC application structure** — routes, controllers, models, and views.
- **Authentication and administration** — sessions, roles, user management, password reset, and optional two-factor authentication.
- **Security-oriented defaults** — CSRF protection, output escaping, security headers, input limits, rate limiting, and prepared database queries.
- **Multiple database engines** — SQLite, PostgreSQL, MySQL, and MariaDB connection formats, with support for named connections.
- **Developer CLI and environment tools** — migrations, configuration validation, and key generation.
- **Documentation and interactive demos** — built into the framework itself.
- **Live Markdown presentations** — presenter controls and real-time audience updates over Server-Sent Events (SSE).

## Requirements

- **Node.js 22.13.0 or newer**
- npm (included with Node.js)
- A terminal: PowerShell, Command Prompt, Bash, or a compatible shell

The framework has no runtime package dependencies. Running npm install is optional for this repository's current setup.

## Quick start

### 1. Get the project

~~~bash
git clone https://github.com/OrpanAp/power-2.0.git
cd power-2.0
~~~

Or download the repository as a ZIP from GitHub and extract it.

### 2. Configure environment variables

Copy the example environment file.

**Windows PowerShell**
~~~powershell
Copy-Item .env.example .env
~~~

**macOS / Linux / Git Bash**
~~~bash
cp .env.example .env
~~~

The default configuration uses a local SQLite database:

~~~dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=3000
DB_URL=sqlite:storage/power.sqlite
~~~

You normally do not need to change the database setting to try the app locally.

### 3. Start the development server

~~~bash
node bin/power-cli.js serve
~~~

The development server supports live reload and automatic restart. On first boot, the app runs setup tasks and prints the initial administrator login details. Keep those details private and change the password after signing in.

Open these routes in your browser:

| Route | Purpose |
| --- | --- |
| / | Application landing page |
| /docs | Framework documentation |
| /demo | Interactive framework demos |
| /admin | Administrator dashboard |
| /presentations | Public presentations |

The default local address is http://127.0.0.1:3000, unless you change HOST or PORT.

### 4. Explore the CLI

Show available commands and usage:

~~~bash
node bin/power-cli.js help
~~~

Useful commands:

~~~bash
node bin/power-cli.js env:check
node bin/power-cli.js db:check
node bin/power-cli.js db:status
node bin/power-cli.js key:generate
npm test
~~~

Use the CLI help output as the source of truth for commands supported by your checked-out version.

## Features

### Application development

- HTTP routing with route parameters, route groups, and middleware
- MVC-style controllers, models, routes, and server-rendered views
- Template layouts, blocks, includes, conditionals, loops, and escaped output
- Request parsing and input validation
- Database migrations and seed data
- Static assets and development live reload
- Centralized logging and a health endpoint

Example route:

~~~js
app.get('/users/:id', auth.requireAuth, (req, res) => {
  res.json({ id: req.params.id });
});
~~~

### Authentication and security

P.O.W.E.R. includes multiple security controls, including:

- Password hashing with scrypt and per-hash salts
- Server-side sessions, session rotation, idle and absolute expiry
- Role-based access control for administrators and users
- Optional TOTP two-factor authentication and single-use backup codes
- CSRF tokens and Origin checks
- Login throttling and account lockout
- Escaped template output, a Content Security Policy, and security headers
- Prepared SQL statements and identifier validation
- Request-size limits and protection against path traversal

Security features reduce risk, but no framework can guarantee that an application is completely secure. Review the code, deployment setup, and threat model before production use.

### Database support

The framework includes connection URL formats and drivers for SQLite, PostgreSQL, MySQL, and MariaDB. SQLite is the default for local development. Set DB_URL in your .env file to select a database.

~~~dotenv
# SQLite
DB_URL=sqlite:storage/power.sqlite

# MySQL
DB_URL=mysql://USER:URL_ENCODED_PASSWORD@127.0.0.1:3306/DATABASE

# MariaDB
DB_URL=mariadb://USER:URL_ENCODED_PASSWORD@127.0.0.1:3306/DATABASE

# PostgreSQL
DB_URL=postgres://USER:URL_ENCODED_PASSWORD@127.0.0.1:5432/DATABASE

# Hosted PostgreSQL with certificate and host verification
DB_URL=postgres://USER:URL_ENCODED_PASSWORD@DB_HOST:5432/DATABASE?sslmode=verify-full

# Hosted MySQL with TLS enabled
DB_URL=mysql://USER:URL_ENCODED_PASSWORD@DB_HOST:3306/DATABASE?ssl=true
~~~

**Important database notes**

- Create the database on your database server before connecting; the URL does not create it.
- URL-encode special characters in usernames and passwords (for example, @ becomes %40 and : becomes %3A).
- For remote databases, follow your provider's TLS guidance. Encryption without certificate verification is not equivalent to verifying the server's identity.
- Additional named connections can use variables such as DB_ANALYTICS_URL.
- The PostgreSQL and MySQL drivers have been checked against protocol test vectors and fake protocol servers; run integration tests against your actual database before relying on those drivers in production.

Run configuration and database diagnostics:

~~~bash
node bin/power-cli.js env:check
node bin/power-cli.js db:check
node bin/power-cli.js db:status
~~~

### Real-time Markdown presentations

Create Markdown slide decks, present them live, and let audience browsers follow the presenter over SSE.

| Route | Purpose |
| --- | --- |
| /admin/presentations | Create and edit presentation decks |
| /present/:slug | Presenter console, speaker notes, timer, and slide controls |
| /live/:slug | Audience view with live updates and reactions |
| /presentations | Browse public decks |

Separate slides with --- on its own line. Presenter notes can be introduced with Notes:. Decks support common Markdown content, themes, keyboard controls, and mobile-friendly viewing.

Live presentation state is held in memory for a single process. After a restart, presentations return to idle; browsers reconnect automatically. Plan for this behavior when deploying.

## Environment configuration

P.O.W.E.R. loads environment settings in layers, from lower to higher priority:

1. .env
2. .env.<mode>
3. .env.local (skipped in test mode)
4. .env.<mode>.local
5. Actual process environment variables

Useful commands:

~~~bash
# Validate configuration and show where values came from
node bin/power-cli.js env:check

# Validate as production
node bin/power-cli.js env:check --env=production

# Generate a session secret
node bin/power-cli.js key:generate

# Write a generated secret to local environment configuration
node bin/power-cli.js key:generate --write

# Set a local environment value
node bin/power-cli.js env:set APP_NAME="My App"
~~~

See [.env.example](.env.example) for recognized variables and defaults. Never commit .env, .env.local, or files containing real secrets or database credentials.

## Production checklist

Before exposing an application to the internet:

- [ ] Set NODE_ENV=production.
- [ ] Configure a strong SESSION_SECRET (at least 32 characters).
- [ ] Set ALLOWED_HOSTS to the hostnames your application should accept.
- [ ] Serve the application over HTTPS, using your hosting platform's TLS termination or supported TLS configuration.
- [ ] Use a production database with the correct TLS settings and backups.
- [ ] Set administrator credentials securely; do not reuse development passwords.
- [ ] Review registration, rate limits, proxy settings, logs, and environment variables.
- [ ] Run the test suite and database integration tests against the actual database engine.
- [ ] Review the single-process limitations below before scaling to multiple instances.

Production cookie settings require HTTPS. Do not treat a development server or local SQLite file as a production deployment plan.

## Tests

Run the project's test suite:

~~~bash
npm test
~~~

The standard suite includes smoke and security tests. Optional live database integration tests can be enabled by setting TEST_PG_URL and/or TEST_MYSQL_URL to test database URLs before running the suite:

~~~bash
TEST_PG_URL="postgres://..." TEST_MYSQL_URL="mysql://..." npm test
~~~

Use test databases only. Integration tests may create or modify database objects.

## Project structure

~~~text
app.js                  Application entry point and middleware pipeline
bin/power-cli.js        Command-line interface
config/                 Environment loading and configuration
core/                   Router, HTTP helpers, sessions, security, database, ORM,
                        migrations, logging, health checks, static files, and more
app/controllers/        Request controllers
app/models/             Data models
app/routes/             Route definitions
app/views/              Server-rendered templates
database/migrations/    Database migration files
database/seed.js        Seed data
docs/                   Markdown documentation pages
public/                 Static CSS, JavaScript, and other assets
tests/                  Automated tests
~~~

## Documentation and demos

Start the server and visit /docs for framework documentation and /demo for interactive examples covering security checks, SQL generation, Markdown slides, streaming, routing/middleware traces, and error handling.

Documentation sources are stored in docs/*.md. To add a page, create a Markdown file and register it in app/docs.js. The project includes checks for internal documentation links, CLI commands, and settings.

## Troubleshooting

**The server does not start**
- Check your Node.js version with node --version; it must be 22.13.0 or newer.
- Run node bin/power-cli.js help and follow the command usage for your version.
- Run node bin/power-cli.js env:check to identify invalid or missing configuration.

**You lost the administrator login**
- Run node bin/power-cli.js admin:info to inspect administrator accounts.
- Use node bin/power-cli.js user:reset-password (or provide an email if supported by the command) to reset the password.
- Set POWER_ADMIN_EMAIL and POWER_ADMIN_PASSWORD before the first boot if you want to choose initial credentials. Use a strong password and keep it private.

**Login or logout returns a 403**
- Reload the page and retry in case the CSRF token expired.
- Check that you are accessing the site through the expected hostname and scheme.
- If a reverse proxy rewrites the host, check the application logs and proxy configuration. Do not disable CSRF protection as a workaround.

**Secure cookies are not saved over HTTP**
- Production cookies are configured for HTTPS. Serve the site over HTTPS rather than weakening cookie settings.

**A remote database connection fails**
- Confirm the database exists, credentials and URL encoding are correct, and the provider allows connections from your host.
- Verify the required TLS mode and certificate settings.
- Run node bin/power-cli.js db:check and test against a dedicated integration-test database.

## Known limitations

- Live presentation state is in memory and designed for a single running process.
- The built-in rate limiter is in memory and does not coordinate across multiple application processes.
- Development live reload is not a production feature.
- The framework does not currently provide multipart file uploads.
- The PostgreSQL and MySQL drivers need to be tested against your actual server/version before production reliance.
- This project does not replace deployment-level controls such as DDoS protection, a WAF, backups, monitoring, and secure secret management.

## Contributing

Bug reports, feature ideas, and improvements are welcome. Please [open an issue](https://github.com/OrpanAp/power-2.0/issues) with clear reproduction steps, expected behavior, and actual behavior. For code changes, include or update tests where practical and explain any security impact.

## License

Check the repository's [LICENSE file](LICENSE) for the terms that apply to this project.
