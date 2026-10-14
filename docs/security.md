# Security guide

No framework can promise "completely secure". P.O.W.E.R. applies **defence in depth**: several independent layers, each of which limits the damage if another fails.

## What is protected, and how

| Threat | Defence |
|---|---|
| SQL injection | Prepared statements and bound parameters only. Identifiers are validated. `LIKE` input is escaped |
| Cross-site scripting | Auto-escaped templates, a strict CSP without inline code, safe Markdown (no raw HTML) |
| CSRF | Same-origin check (`Sec-Fetch-Site` or `Origin`) plus a per-session token on every unsafe request |
| Session theft and fixation | HttpOnly SameSite cookies, `__Host-` prefix in production, ID rotation, User-Agent binding, idle and absolute timeouts |
| Password attacks | scrypt, a password policy, rate limits, account lockout, timing equalization, optional TOTP |
| Host-header attacks | `ALLOWED_HOSTS` allow-list |
| Clickjacking | `X-Frame-Options: DENY` and `frame-ancestors 'none'` |
| Path traversal | Static files resolve real paths and block dotfiles and symlink escapes |
| Prototype pollution | Dangerous keys are dropped from all input |
| Resource exhaustion | Body, header, depth and parameter limits, request timeouts, connection caps, rate limits |
| Open redirects | `res.redirect` accepts only local paths |
| Information leaks | Generic 5xx messages in production, minimal `/health`, `no-store` caching on dynamic pages |
| Secrets at rest | AES-256-GCM for two-factor secrets, hashed backup codes, masked admin views |

## Response headers

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'` (plus `upgrade-insecure-requests` in production) |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `same-origin` |
| `Permissions-Policy` | camera, microphone, geolocation, payment and USB disabled |
| `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy` | `same-origin` |
| `Strict-Transport-Security` | 2 years, production or `FORCE_HTTPS` |
| `Cache-Control` | `no-store` on dynamic responses |

## CSRF in detail

Unsafe methods (POST, PUT, PATCH, DELETE) must pass two checks:

1. **Origin check.** If the browser sends `Sec-Fetch-Site`, it must be `same-origin` or `none`. Otherwise `Origin` must match `Host`. A literal `Origin: null` (what browsers send for same-origin form posts under some referrer policies) is not treated as hostile.
2. **Token.** The hidden field `_csrf` or the header `X-CSRF-Token` must match the session's token.

For `fetch` calls, read the token from a meta tag or a data attribute and send it as a header:

```js
fetch('/present/talk/control', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
  body: JSON.stringify({ action: 'start' }),
});
```

A rejection is written to the system log with its exact reason ("cross-site request" or "missing or invalid token").

## Production checklist

* `NODE_ENV=production` and a random `SESSION_SECRET` (32+ characters).
* Serve over **HTTPS** (a reverse proxy or `TLS_CERT` and `TLS_KEY`). Production cookies are `Secure`.
* Set `ALLOWED_HOSTS`. Set `TRUST_PROXY=1` only behind a proxy you control.
* Remote databases: use `sslmode=verify-full` (PostgreSQL) or `ssl=true` (MySQL).
* `REQUIRE_ADMIN_2FA=1`.
* Choose your own `POWER_ADMIN_EMAIL` and a strong `POWER_ADMIN_PASSWORD`, or reset it right after the first start.
* Keep `.env*` files out of version control and off the web root.
* Back up the database and test the restore.
* Run `node bin/power-cli.js env:check --env=production`.

## Not covered

DDoS protection, a web application firewall, secret management, shared rate limiting across several processes, and QR codes for two-factor setup. Put the app behind a reverse proxy or CDN for those, and see [Deployment](/docs/deployment).
