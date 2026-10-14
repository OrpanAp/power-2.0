# Project structure

```text
app.js                   boot + middleware pipeline
bin/power-cli.js         command line tool
config/                  env.js (loader + schema), config.js (typed settings)
core/                    the framework: router, server, views, sessions, security, db ...
app/
  controllers/           request handlers (classes with static methods)
  models/                database models
  routes/                route tables (web, admin, presentations, site)
  views/                 templates (layouts, partials, pages)
  auth.js                auth helpers bound to the User model
database/
  migrations/            timestamped migration files
  seed.js                first admin + demo presentation
docs/                    the Markdown files behind /docs
public/                  static files (css, js, images)
storage/                 SQLite files, dev secret (git-ignored)
tests/                   node:test suites
```

## The request lifecycle

![How a request flows through P.O.W.E.R.](/img/request-flow.svg)

Every request passes through the same pipeline, defined in `app.js`:

1. **Security headers** - CSP, `X-Content-Type-Options`, frame and cross-origin policies, HSTS in production.
2. **Host guard** - rejects unknown `Host` headers when `ALLOWED_HOSTS` is set and can force HTTPS.
3. **Static files** - `public/` is served first, with traversal and symlink protection.
4. **Live reload channel** - development only.
5. **Global rate limit** - per IP.
6. **Body parser** - JSON and URL-encoded, size and depth limits, input sanitization.
7. **Session** - lazy server-side session (nothing is stored until it holds data).
8. **Load user** - `req.user` from the session.
9. **CSRF** - same-origin check and token for unsafe methods.
10. **Router** - your routes, then the 404 and error handler.

## Layers

![Framework layers](/img/architecture.svg)

* **`core/`** knows nothing about your application. It never imports from `app/`.
* **`app/`** is yours: controllers, models, views and routes.
* **Databases** are reached only through the `Connection` API in `core/db`, so SQLite, PostgreSQL and MySQL are interchangeable.

## MVC in practice

* **Model** - `app/models/User.js` extends `Model` and describes a table.
* **View** - `app/views/*.html` templates, rendered with `res.render(name, data)`.
* **Controller** - `app/controllers/*.js` static methods `(req, res, next)`, async allowed.
* **Routes** - `app/routes/*.js` connect URLs to controllers and attach middleware.

See [Routing & middleware](/docs/routing) next.
