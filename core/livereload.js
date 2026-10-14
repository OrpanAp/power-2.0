import fs from "node:fs";
import path from "node:path";

const CLIENT = `(() => {
  if (window.__powerLR) return; window.__powerLR = true;
  let down = false;
  const es = new EventSource('/__power/events');
  es.addEventListener('open', () => { if (down) location.reload(); });   // server restarted
  es.addEventListener('error', () => { down = true; });
  es.addEventListener('reload', (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'css') refreshCss(); else if (m.type === 'view') syncDom(); else location.reload();
  });
  function refreshCss() {
    document.querySelectorAll('link[rel="stylesheet"]').forEach((l) => {
      const u = new URL(l.href); if (u.origin !== location.origin) return;
      u.searchParams.set('_lr', Date.now());
      const n = l.cloneNode(); n.href = u.toString(); n.onload = () => l.remove(); l.after(n);
    });
  }
  async function syncDom() {          // soft DOM sync: swap <body> without a full reload, keep scroll + focus
    if (document.body.hasAttribute('data-no-sync')) return location.reload();
    try {
      const r = await fetch(location.href, { credentials: 'same-origin', headers: { 'X-Power-Sync': '1' } });
      if (!r.ok || !(r.headers.get('content-type') || '').includes('text/html')) return location.reload();
      const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
      const y = scrollY, focus = document.activeElement && document.activeElement.id;
      document.title = doc.title;
      document.body.innerHTML = doc.body.innerHTML;
      scrollTo(0, y);
      if (focus) { const el = document.getElementById(focus); if (el) el.focus(); }
      document.dispatchEvent(new CustomEvent('power:sync'));
    } catch { location.reload(); }
  }
})();`;

/** Dev-only live reload over Server-Sent Events. Watches views/public; CSS hot-swaps, views soft-sync, other assets reload. */
export class LiveReload {
  constructor(dirs) {
    this.dirs = dirs;
    this.clients = new Set();
    this.timers = new Map();
    this.watchers = [];
  }

  middleware() {
    return (req, res, next) => {
      if (req.path === "/__power/livereload.js") {
        res.setHeader("Cache-Control", "no-store");
        return res.send(CLIENT, "application/javascript; charset=utf-8");
      }
      if (req.path !== "/__power/events") return next();
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write("retry: 500\n\n");
      this.clients.add(res);
      req.on("close", () => this.clients.delete(res));
    };
  }
  broadcast(type, file) {
    const msg = `event: reload\ndata: ${JSON.stringify({ type, file })}\n\n`;
    for (const c of this.clients) c.write(msg);
  }
  start() {
    for (const dir of this.dirs) {
      try {
        const w = fs.watch(dir, { recursive: true }, (_evt, name) => {
          if (!name || String(name).startsWith(".")) return;
          clearTimeout(this.timers.get(name));
          this.timers.set(
            name,
            setTimeout(() => {
              const ext = path.extname(String(name)).toLowerCase();
              this.broadcast(
                ext === ".css"
                  ? "css"
                  : dir.includes("views")
                    ? "view"
                    : "full",
                String(name),
              );
            }, 60),
          );
        });
        w.on("error", () => {});
        w.unref?.();
        this.watchers.push(w);
      } catch (e) {
        console.warn(`[livereload] cannot watch ${dir}: ${e.message}`);
      }
    }
    this.heartbeat = setInterval(() => {
      for (const c of this.clients) c.write(": ping\n\n");
    }, 25000);
    this.heartbeat.unref();
  }
  stop() {
    this.watchers.forEach((w) => w.close());
    clearInterval(this.heartbeat);
    this.clients.forEach((c) => c.end());
  }
}
