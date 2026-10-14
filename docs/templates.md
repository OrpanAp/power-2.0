# Templates & views

Views are `.html` files in `app/views/`. Rendering is done by the built-in engine in `core/view.js`.

```js
res.render('admin/users/index', { title: 'Users', users });
```

## Output

```html
<h1>{{ title }}</h1>        <!-- HTML-escaped (safe) -->
{{{ trustedHtml }}}         <!-- raw, use only for HTML you generated and trust -->
```

A missing variable renders as an empty string instead of crashing the page: `{{ user.profile.name }}` is safe even when `user` is `null`.

## Control flow

```html
<% if user.role == 'admin' %>
  <a href="/admin">Admin</a>
<% elseif user %>
  <a href="/dashboard">Dashboard</a>
<% else %>
  <a href="/login">Sign in</a>
<% endif %>

<% unless items.length %><p>Nothing here.</p><% endunless %>

<% for item in items %>
  <li>{{ item.name }}</li>
<% endfor %>

<% for item, i in items %>
  <li>{{ i + 1 }}. {{ item.name }}</li>
<% endfor %>
```

`for` loops over arrays. Use the `entries()` helper for objects: `<% for pair in entries(obj) %>`.

## Layouts and blocks

`app/views/layouts/main.html`:

```html
<!doctype html>
<title><% block title %>{{ title }} - {{ appName }}<% endblock %></title>
<main><% block content %><% endblock %></main>
```

A page that uses it:

```html
<% extends "layouts/main" %>
<% block content %>
  <h1>Welcome</h1>
<% endblock %>
```

Inside a child block, `<% super %>` inserts the parent block's default content. Layouts can extend other layouts. Blocks cannot be nested inside other blocks.

## Includes

```html
<include type="html" path="partials/flash">
```

`type="html"` inlines another template (it can use the same variables). `type="text"` inserts a file as escaped text.

## Variables available everywhere

| Name | Value |
|---|---|
| `appName`, `isDev`, `publicEnv` | App settings and `PUBLIC_*` env values |
| `user` | The signed-in user or `null` |
| `path`, `query` | Current path and query |
| `flash` | One-time messages: `flash.success`, `flash.error`, `flash.info` |
| `errors`, `old` | Validation errors and previous input after `res.invalid()` |
| `csrfToken`, `csrfField` | CSRF token and a ready-made hidden input |
| `liveReload` | The live-reload script tag in development |

## Helpers

| Helper | Example |
|---|---|
| `fmtDate(value)` | `2026-10-14 09:30 UTC` |
| `fmtBytes(n)` | `12.4 MB` |
| `fmtUptime(seconds)` | `2d 4h 12m` |
| `truncate(text, n)` | Shorten with an ellipsis |
| `json(value)` | Pretty JSON (still escaped on output) |
| `entries(obj)` | `[key, value]` pairs |
| `selected(a, b)`, `checked(cond)` | Attribute helpers, use with triple braces |
| `cap(text)` | Capitalize |

```html
<option value="admin" {{{ selected(old.role || target.role, 'admin') }}}>admin</option>
```

## Forms

Every state-changing form needs the CSRF field:

```html
<form method="post" action="/login">
  {{{ csrfField }}}
  <input name="email" value="{{ old.email }}">
  <% if errors.email %><small class="err">{{ errors.email[0] }}</small><% endif %>
</form>
```

## Content Security Policy

The default CSP is `script-src 'self'; style-src 'self'`. That means:

* **No inline `<script>` and no `onclick=` attributes.** Put JavaScript in `public/js/` and attach events with `addEventListener`.
* **No `style="..."` attributes.** Use classes. Changing `element.style` from JavaScript is allowed.
* Images may come from your own site or `data:` URLs.

## A note on trust

Template expressions are compiled with `new Function`. They are code written by **you**. Never build a template from user input; pass user input as data, where it is escaped automatically.
