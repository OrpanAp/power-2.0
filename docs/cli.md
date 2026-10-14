# CLI reference

Run commands with `node bin/power-cli.js <command>`. Run `help` for a summary.

## Project and server

| Command | Description |
|---|---|
| `init [dir]` | Scaffold a project: copies the framework, creates `.env` with a fresh `SESSION_SECRET`, `.env.example` and `.gitignore` |
| `serve [--port=3000] [--host=...] [--prod] [--no-watch]` | Start the server. In development it restarts on backend changes and live-reloads the browser |

## Generators

| Command | Description |
|---|---|
| `make:controller <Name> [--resource]` | Creates `app/controllers/<Name>Controller.js` (`--resource` adds CRUD methods) |
| `make:model <Name> [-m]` | Creates `app/models/<Name>.js`, and with `-m` a matching migration |
| `make:migration <name>` | Creates a timestamped migration. Names like `create_posts_table` get a table template |

Existing files are never overwritten unless you pass `--force`.

## Database

| Command | Description |
|---|---|
| `db:migrate` | Run pending migrations |
| `db:rollback` | Roll back the last batch |
| `db:status` | Show which migrations ran |
| `db:seed` | Create the first admin and the demo deck if missing |
| `db:check` | Ping every configured connection |

Add `--connection=<name>` to target an extra database (migrations live in `database/migrations/<name>/`).

## Users

| Command | Description |
|---|---|
| `admin:info` | List admin accounts and show first-boot credentials in development |
| `user:reset-password [email]` | New random password (default: the first admin). Clears lockout and signs the user out everywhere |
| `user:disable-2fa <email>` | Remove a user's two-factor enrolment |

## Environment

| Command | Description |
|---|---|
| `env:check [--env=production]` | Validate settings, show values (secrets masked) and their source. Exit code 1 on errors |
| `env:get <KEY> [--reveal]` | Print one resolved value |
| `env:set KEY=VALUE [--file=.env.local]` | Create or update a variable, preserving the file |
| `env:example` | Write `.env.example` from the settings schema |
| `key:generate [--write]` | Print a random `SESSION_SECRET`, or store it in `.env.local` |

## Presentations

| Command | Description |
|---|---|
| `presentation:import <deck.md> [--slug= --title= --theme= --public]` | Import a Markdown deck |

## npm scripts

```bash
npm start        # node app.js, production style
npm run dev      # same as: serve
npm run migrate  # same as: db:migrate
npm test         # node --test
```
