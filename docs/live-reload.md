# Live reload

In development (`NODE_ENV=development`) the browser updates itself when you save a file. No browser extension or build tool is involved: the server watches `app/views/` and `public/` and pushes events over a Server-Sent Events channel at `/__power/events`.

| You change | What happens in the browser |
|---|---|
| A `.css` file | Stylesheets are swapped in place, no reload |
| A view (`.html`) | The page body is re-fetched and swapped (**soft DOM sync**), keeping scroll position and focus |
| Other files in `public/` (JS, images) | Full reload |
| A controller, model, route or core file | The dev supervisor restarts the server, the browser reconnects and reloads |

## Starting it

```bash
node bin/power-cli.js serve          # live reload and auto-restart
node bin/power-cli.js serve --prod   # production mode, no watching
```

Turn the browser part off with `LIVE_RELOAD=0`. It is always off in production and test.

## Pages that manage their own state

Soft DOM sync replaces the page body, which would throw away JavaScript state. Mark such pages with `data-no-sync` on `<body>` and they get a full reload instead. The live presentation pages do this.

```html
<body data-no-sync>
```

Scripts can also listen for the sync:

```js
document.addEventListener('power:sync', () => { /* re-run any setup */ });
```

> **Tip:** use event delegation (`document.addEventListener('click', ...)`) in your own scripts. It keeps working after a soft DOM sync.
