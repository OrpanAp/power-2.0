# Testing

The test suite uses only `node:test` and `node:assert`.

```bash
npm test                                   # everything
node --test tests/smoke.test.js            # one file
TEST_PG_URL=postgres://... TEST_MYSQL_URL=mysql://... npm test   # also run the live-database tests
```

## What is covered

| File | Covers |
|---|---|
| `tests/smoke.test.js` | Headers, CSRF, login, lockout, 2FA, sessions, XSS, SQL injection, RBAC, templates |
| `tests/db.test.js` | Several connections, models, transactions, migrations, schema SQL per dialect, optional live PostgreSQL and MySQL |
| `tests/protocol.test.js` | SCRAM-SHA-256 against the RFC vector, wire protocol of the PostgreSQL and MySQL drivers against fake servers |
| `tests/env.test.js` | Env file layering, syntax, `_FILE` secrets, validation, masking |
| `tests/presentations.test.js` | Markdown safety, deck parsing, access control, real-time sync, limits |
| `tests/site.test.js` | Docs pages and links, search, demo endpoints |

## Writing a test

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, Client } from './helpers.js';

setupEnv();                                         // temp SQLite DB, test secret, relaxed rate limits
const { boot } = await import('../app.js');
const { manager } = await import('../core/database.js');

let app, base;
before(async () => { app = await boot({ quiet: true }); base = `http://127.0.0.1:${(await app.listen(0, '127.0.0.1')).port}`; });
after(async () => { await app.close(); await manager.closeAll(); });

test('home page renders', async () => {
  const c = new Client(base);
  const r = await c.req('GET', '/');
  assert.equal(r.status, 200);
});
```

Helpers in `tests/helpers.js`:

* `setupEnv(extra)` sets the environment **before** the app is imported.
* `Client` keeps cookies: `req`, `json`, `csrf(url)`, `login(email, password)`, `post(url, form, fromUrl)` (fetches a CSRF token first).
* `openSse(port, path, cookie)` and `waitFor(sse, predicate)` for Server-Sent Events.
* `rawRequest(port, hostHeader)` for tests that need a custom `Host` header.

> **Tip:** import the app with a dynamic `await import()` after `setupEnv()`, because configuration is read once when `config/config.js` loads.
