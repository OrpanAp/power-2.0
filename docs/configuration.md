# Configuration & environment

All settings come from environment variables. They are loaded from files, validated, and turned into typed values in `config/config.js`.

## File layers

Lowest priority first. The **real process environment always wins**.

1. `.env`
2. `.env.<mode>` (for example `.env.production`)
3. `.env.local` (skipped when `NODE_ENV=test`)
4. `.env.<mode>.local`

`NODE_ENV` itself may be written in `.env`. The mode defaults to `development`.

## Syntax

```env
# comments start with #
APP_NAME="My App"                 # double quotes: \n escapes, multi-line, ${expansion}
GREETING='literal $text'          # single quotes: literal
export PORT=8080                  # optional export
DB_URL=sqlite:storage/${APP_NAME:-power}.sqlite
HOMEPAGE=https://example.com/#top # '#' without a leading space is data
PRICE=\$5                         # \$ is a literal dollar sign
```

## Secrets from files

For Docker or Kubernetes secrets, any framework setting accepts a `_FILE` variant. It is used only when the plain variable is unset.

```env
SESSION_SECRET_FILE=/run/secrets/session_secret
DB_URL_FILE=/run/secrets/database_url
```

## Settings

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | Mode: development, test or production |
| `APP_NAME` | `P.O.W.E.R.` | Shown in the UI and as the 2FA issuer |
| `HOST` / `PORT` | `127.0.0.1` / `3000` | Where to listen |
| `SESSION_SECRET` | (dev: generated file) | 32+ characters. **Required in production** |
| `PASSWORD_PEPPER` | empty | Optional server-side secret mixed into password hashes |
| `DB_URL` | `sqlite:storage/power.sqlite` | Default database, see [Databases](/docs/database) |
| `DB_<NAME>_URL` | none | Extra named connections |
| `DB_POOL_MAX` | `5` | Pool size for PostgreSQL and MySQL |
| `SESSION_TTL_HOURS` | `12` | Idle timeout (sliding) |
| `SESSION_ABSOLUTE_HOURS` | `72` | Hard session lifetime |
| `BODY_LIMIT` | `1048576` | Max request body in bytes |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-*` (only behind your own proxy) |
| `ALLOWED_HOSTS` | empty | Comma list of accepted Host headers |
| `FORCE_HTTPS` | `false` | Redirect HTTP to HTTPS |
| `TLS_CERT` / `TLS_KEY` | empty | Paths that enable native HTTPS |
| `MAX_CONNECTIONS` | `1000` | Max concurrent sockets |
| `RATE_LIMIT_PER_MINUTE` | `300` | Global per-IP limit |
| `AUTH_RATE_LIMIT` | `20` | Login and register attempts per IP per 15 minutes |
| `ALLOW_REGISTRATION` | `true` | Public sign-ups |
| `REQUIRE_ADMIN_2FA` | `false` | Force admins to enrol two-factor authentication |
| `LIVE_RELOAD` | `true` | Development live reload |
| `POWER_ADMIN_EMAIL` | `admin@power.local` | First-boot admin email |
| `POWER_ADMIN_PASSWORD` | random | First-boot admin password |
| `PRESENTATION_MAX_SLIDES` | `200` | Slides per deck |
| `PRESENTATION_MAX_KB` | `200` | Deck size in KB |
| `PRESENTATION_MAX_VIEWERS` | `2000` | Live viewers per deck |
| `PRESENTATION_MAX_CONN_PER_IP` | `10` | Live connections per IP |

## Validation at startup

Invalid values stop the server with **every** problem listed, for example a non-numeric `PORT` or a missing production `SESSION_SECRET`. Typos in env files get a hint:

```console
$ node bin/power-cli.js env:check --env=production
✗ SESSION_SECRET is required in production
⚠ SESON_TTL_HOURS is not a known setting - did you mean SESSION_TTL_HOURS?
```

## Public values in templates

Only variables starting with `PUBLIC_` are visible to templates:

```env
PUBLIC_ANALYTICS_ID=G-12345
```

```html
<script src="/js/analytics.js" data-id="{{ publicEnv.PUBLIC_ANALYTICS_ID }}"></script>
```

## Reading settings in code

```js
import { config } from './config/config.js';   // typed, validated settings
import { env } from './config/env.js';          // raw access with coercion

env('CUSTOM_FLAG', 'x');      // string with fallback
env.int('CUSTOM_LIMIT', 10);
env.bool('CUSTOM_ON', false);
env.list('CUSTOM_LIST');      // "a, b" -> ['a', 'b']
env.required('CUSTOM_KEY');   // throws when missing
```

## CLI helpers

```bash
node bin/power-cli.js env:check              # every setting, its source, secrets masked
node bin/power-cli.js env:set APP_NAME="My App"   # writes .env.local (mode 0600)
node bin/power-cli.js env:get SESSION_SECRET --reveal
node bin/power-cli.js env:example            # writes .env.example from the schema
node bin/power-cli.js key:generate --write   # new SESSION_SECRET into .env.local
```

> **Note:** never commit `.env`, `.env.local` or `.env.*.local`. Rotating `SESSION_SECRET` signs everyone out and makes stored two-factor secrets unreadable.
