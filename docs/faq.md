# FAQ & troubleshooting

## I lost the admin password

```bash
node bin/power-cli.js admin:info
node bin/power-cli.js user:reset-password
```

In development, `admin:info` also shows the password generated at first boot (stored in `storage/.admin-credentials`). In production passwords are never written to disk.

## Login says "Request blocked" or "Your session expired"

* **Stale form or cookie.** Reload the page and try again.
* **Cross-site request.** The browser reported the request as cross-site (`Sec-Fetch-Site`), or `Origin` does not match `Host`. Open the site directly rather than inside an iframe or a preview pane.
* The exact reason is logged: look for "Request rejected by CSRF protection" in the admin **System logs**.

## Cookies do not stick in production over HTTP

Production cookies use the `__Host-` prefix and `Secure`, so they need HTTPS. Use a TLS proxy or `TLS_CERT` and `TLS_KEY`.

## The server will not start

Read the message: configuration errors list every problem. Run `node bin/power-cli.js env:check`. A common one is a missing `SESSION_SECRET` in production.

## "Unexpected token" or "node:sqlite not found"

You need Node.js 22.13 or newer: `node -v`.

## "ExperimentalWarning: SQLite is an experimental feature"

Harmless. The npm scripts and the `serve` command pass `--disable-warning=ExperimentalWarning`.

## SQLite says the database is locked

The driver uses WAL mode and a busy timeout. Inside `db.transaction(async (tx) => ...)` use only `tx`. Calling the global `db` there waits for the transaction forever.

## I lost my authenticator device

An admin can disable 2FA: `node bin/power-cli.js user:disable-2fa user@example.com`. Users can also sign in with one of their eight backup codes.

## Can I use a different port or host?

`PORT=8080 HOST=0.0.0.0 node bin/power-cli.js serve` or set them in `.env`.

## How do I allow people to upload files?

Multipart bodies are not supported. Upload to object storage from the browser with a signed URL, or add a body parser to `core/body.js` for `multipart/form-data`.

## Can I embed the app in an iframe?

The default policy forbids it (`frame-ancestors 'none'`). Change it deliberately in `core/middleware.js` if you need to, and understand the clickjacking risk.

## Does it support HTTP/2?

Put it behind a proxy that does (nginx, Caddy). The built-in server speaks HTTP/1.1.

## How do I report a security problem?

Please report it privately to the maintainers of your deployment instead of opening a public issue.
