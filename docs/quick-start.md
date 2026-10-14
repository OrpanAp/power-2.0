# Quick start

## 1. Run it

```bash
unzip power-framework.zip
cd power
node bin/power-cli.js serve
```

The first start creates the SQLite database, runs the migrations, seeds a demo presentation and creates the **administrator account**. A random password is printed once:

```text
  ┌─ Initial admin account ─────────────────────
  │ email:    admin@power.local
  │ password: (random, 20 characters)
  └─────────────────────────────────────────────
```

Open `http://127.0.0.1:3000/login` and sign in.

> **Tip:** you can choose the credentials yourself before the first start with `POWER_ADMIN_EMAIL` and `POWER_ADMIN_PASSWORD` (at least 10 characters, not a common password).

## 2. Lost the admin password?

```bash
node bin/power-cli.js admin:info             # lists admins (and the first-boot password in development)
node bin/power-cli.js user:reset-password    # sets a new random password for the first admin
```

## 3. Things to open

| URL | What it is |
|---|---|
| `/` | The landing page |
| `/docs` | These docs |
| `/demo` | Interactive demos of the framework features |
| `/admin` | Admin dashboard (admins only) |
| `/live/welcome` | The seeded live presentation (audience view) |
| `/present/welcome` | The presenter console for the same deck (admins only) |

## 4. Add your first page

Create a controller and a route:

```bash
node bin/power-cli.js make:controller Hello
```

Edit `app/controllers/HelloController.js`:

```js
export class HelloController {
  static index(req, res) {
    res.render('hello', { title: 'Hello', name: req.query.name || 'world' });
  }
}
```

Create the view `app/views/hello.html`:

```html
<% extends "layouts/main" %>
<% block content %>
  <h1>Hello, {{ name }}!</h1>
<% endblock %>
```

Register the route in `app/routes/web.js`:

```js
import { HelloController } from '../controllers/HelloController.js';
// ...
app.get('/hello', HelloController.index);
```

Visit `/hello?name=Ada`. In development the page refreshes itself whenever you save a view or a CSS file, see [Live reload](/docs/live-reload).

## 5. Run the tests

```bash
npm test
```

## Next steps

* Understand the pieces: [Project structure](/docs/project-structure)
* Configure it: [Configuration & environment](/docs/configuration)
* Go to production: [Deployment](/docs/deployment)
