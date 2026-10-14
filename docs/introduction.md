# Introduction

**P.O.W.E.R.** (*Progressively Optimized Web Engine for Rendering*) is a complete web framework for Node.js that ships with **zero third-party dependencies**. The server, router, template engine, sessions, authentication, validation, migrations, database drivers, live reload and an admin panel are all built on Node's own modules (`node:http`, `node:crypto`, `node:net`, `node:sqlite`, ...). The `dependencies` list in `package.json` is empty.

> **Note:** P.O.W.E.R. needs **Node.js 22.13 or newer** because it uses the built-in `node:sqlite` module.

## Why zero dependencies?

* **Nothing to audit.** No transitive packages means no supply-chain surprises. What you read in `core/` is everything that runs.
* **Nothing to install.** Unzip, run one command, you have a working app with a database, admin panel and login.
* **Small enough to understand.** The whole framework is a few thousand lines of readable JavaScript with tests.

## What is included

| Area | What you get |
|---|---|
| Web | HTTP/HTTPS server, Express-style router, middleware chaining, route groups, static files |
| Views | Template engine with inheritance, blocks, includes, auto-escaping and live DOM sync in development |
| Data | SQLite, PostgreSQL and MySQL/MariaDB drivers, several named connections, models, a portable schema builder and migrations |
| Security | scrypt passwords, server-side sessions, CSRF, strict CSP, account lockout, TOTP two-factor, encrypted secrets, rate limits |
| Features | Admin dashboard, live Markdown presentations over Server-Sent Events, system logs, health metrics |
| Tooling | A CLI (`bin/power-cli.js`), layered `.env` support with validation, and a test suite that uses only `node:test` |

## What it is not

* It is not a front-end framework. Pages are rendered on the server; the browser gets plain HTML, CSS and small vanilla-JS enhancements.
* It does not accept multipart file uploads. Bodies are JSON or URL-encoded forms.
* Live presentation state, the rate limiters and sessions' in-memory caches live inside **one process**. See [Deployment](/docs/deployment) for scaling notes.

## How these docs are organised

Start with the [Quick start](/docs/quick-start), then read [Project structure](/docs/project-structure) to see how a request travels through the framework. The **Basics** section covers routing, templates, databases and validation. The **Security** section explains authentication and the hardening that is on by default. Everything is also demonstrated live on the [demo pages](/demo).

> **Tip:** use the search box in the sidebar, or press `/` to jump to it.
