# Routing & middleware

The router is Express-style, but tiny and built in. Routes live in `app/routes/*.js`.

## Defining routes

```js
export function webRoutes(app) {
  app.get('/', HomeController.index);
  app.post('/login', auth.requireGuest, authLimiter, AuthController.login);
  app.get('/users/:id', async (req, res) => {
    const user = await User.find(Number(req.params.id));
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json(User.serialize(user));
  });
}
```

Methods: `get`, `post`, `put`, `patch`, `delete`, `head`, `options` and `all`. Paths support **named parameters** (`/users/:id`) and a trailing wildcard (`/files/*`, available as `req.params['*']`). Matching is case-insensitive and ignores a trailing slash.

Handlers receive `(req, res, next)` and may be `async`. A rejected promise or a thrown error is passed to the error handler for you.

## Middleware

```js
app.use(securityHeaders(config));        // every request
app.use('/admin', requireAdmin);         // every request whose path starts with /admin
app.post('/login', limiter, controller); // route-level chain, in order
```

A middleware either responds, or calls `next()` to continue, or calls `next(err)` to jump to the error handlers.

## Route groups

```js
app.group('/admin', [auth.requireRole('admin'), auth.require2fa], (r) => {
  r.get('/', AdminController.dashboard);
  r.get('/users', AdminController.usersIndex);
  r.delete('/users/:id', AdminController.usersDestroy);
});
```

Group middleware is prepended to each route and groups can be nested.

## The request object

| Property | Meaning |
|---|---|
| `req.params` | Route parameters |
| `req.query` | Parsed and sanitized query string |
| `req.body` | Parsed and sanitized JSON or form body |
| `req.cookies` | Parsed cookies |
| `req.path`, `req.originalUrl` | Decoded path, full URL |
| `req.ip`, `req.secure` | Client address (proxy aware with `TRUST_PROXY`), HTTPS flag |
| `req.session` | Session object, see [Authentication](/docs/authentication) |
| `req.user` | Signed-in user row or `null` |
| `req.app` | The application (`req.app.config`, `req.app.hub`) |

## The response object

| Method | What it does |
|---|---|
| `res.status(code)` | Sets the status, chainable |
| `res.render(view, data)` | Renders a template, see [Templates](/docs/templates) |
| `res.json(obj)`, `res.html(s)`, `res.text(s)`, `res.send(body, type)` | Sends a body |
| `res.redirect(url, code?)` | Redirect to a **local** path only (open-redirect safe). 303 after non-GET |
| `res.back(fallback)` | Redirect to the referring page on this site |
| `res.invalid(errors, old, url)` | Flash validation errors and old input, then redirect |
| `res.cookie(name, value, opts)`, `res.clearCookie(name)` | Cookies (HttpOnly and SameSite=Lax by default) |
| `res.set(name, value)` | Sets a header |

Dynamic responses get `Cache-Control: no-store` automatically.

## Errors

Throw an `HttpError` anywhere and the right status and page are produced:

```js
import { HttpError } from '../../core/errors.js';

if (!deck) throw new HttpError(404, 'Presentation not found');
```

Add your own error handler (four arguments) when you need custom behaviour:

```js
app.use((err, req, res, next) => {
  if (err.code === 'MY_CODE') return res.status(409).json({ error: err.message });
  next(err);   // fall through to the built-in handler
});
```

In production the message of a 5xx error is replaced by a generic text and the details go to the system log.

## HTML forms and PUT/DELETE

Browsers only send GET and POST. Add a hidden `_method` field and the router treats the request as that method:

```html
<form method="post" action="/admin/users/5">
  {{{ csrfField }}}
  <input type="hidden" name="_method" value="DELETE">
  <button>Delete</button>
</form>
```

## Body parsing

`application/json` and `application/x-www-form-urlencoded` are supported. `multipart/form-data` answers **415**. Bodies above `BODY_LIMIT` answer **413**. Deeply nested data (more than 8 levels) and more than 1000 query parameters answer **400**.

## Rate limiting

```js
import { rateLimit } from '../../core/middleware.js';

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'Slow down.' });
app.post('/login', limiter, AuthController.login);
```

The limiter is in memory and per process. See [Deployment](/docs/deployment).
