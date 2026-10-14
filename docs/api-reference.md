# Core API reference

A map of the modules in `core/`. Read the source for details: each file is small and commented.

## Server and routing

| Module | Exports | Purpose |
|---|---|---|
| `core/server.js` | `PowerApp` | HTTP/HTTPS server, error handling, `buildContext` for views |
| `core/router.js` | `Router` | `get/post/...`, `use`, `group`, `routeList` |
| `core/http.js` | `augment`, `parseCookies`, `parseQuery`, `MIME`, `wantsJson` | Adds `req` and `res` helpers |
| `core/body.js` | `bodyParser` | JSON and form bodies, `_method` override |
| `core/static.js` | `serveStatic` | Static files |
| `core/middleware.js` | `securityHeaders`, `hostGuard`, `rateLimit` | Hardening middleware |
| `core/errors.js` | `HttpError`, `abort` | Throwable HTTP errors |

## Views

| Module | Exports |
|---|---|
| `core/view.js` | `ViewEngine` (`render(name, ctx)`) |
| `core/helpers.js` | `helpers`, `buildPager(result, req)` |
| `core/markdown.js` | `renderMarkdown`, `parseDeck`, `renderDoc` |
| `core/highlight.js` | `highlight(code, lang)` |

## Data

| Module | Exports |
|---|---|
| `core/database.js` | `db` (default connection), `manager`, `Connection`, `quoteId`, `parseDbUrl` |
| `core/db/schema.js` | `Schema`, `Blueprint` |
| `core/db/drivers/*.js` | SQLite, PostgreSQL and MySQL drivers |
| `core/model.js` | `Model` |
| `core/migrator.js` | `Migrator` |

`Connection` methods: `all`, `get`, `run`, `exec`, `insert`, `upsert`, `transaction`, `tables`, `columns`, `ping`, `info`, `close`, `q`, and the `schema` property.

## Security

| Module | Exports |
|---|---|
| `core/security.js` | `escapeHtml`, `stripTags`, `sanitizeInput`, `hashPassword`, `verifyPassword`, `needsRehash`, `randomToken`, `safeEqual`, `sha256hex` |
| `core/passwordPolicy.js` | `checkPassword`, `passwordRule` |
| `core/validator.js` | `Validator` |
| `core/session.js` | `Session`, `SessionStore`, `sessionMiddleware` |
| `core/csrf.js` | `csrf({ exempt })` |
| `core/auth.js` | `createAuth(UserModel)` |
| `core/crypto.js` | `encrypt`, `decrypt` (AES-256-GCM) |
| `core/totp.js` | `generateSecret`, `hotp`, `verifyTotp`, `otpauthUri` |

## Real time and operations

| Module | Exports |
|---|---|
| `core/live.js` | `LiveHub`, `REACTIONS` (live presentation rooms over SSE) |
| `core/livereload.js` | `LiveReload` (development) |
| `core/health.js` | `collectHealth(app)` |
| `core/logger.js` | `Logger.debug/info/warn/error` (console and `system_logs`) |

## Configuration

| Module | Exports |
|---|---|
| `config/config.js` | `config`, `ROOT` |
| `config/env.js` | `SCHEMA`, `loadEnvFiles`, `parseDotenv`, `resolveEnv`, `describeEnv`, `setEnvVar`, `env` |

## Application entry points

```js
import { boot, createApp, prepareDatabase } from './app.js';

const app = await boot();                   // migrate + seed + create the app
await app.listen(3000, '127.0.0.1');
await app.close();
```

`boot()` is also how the tests start a server on a random port.
