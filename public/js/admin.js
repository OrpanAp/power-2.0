// Live health metrics on the admin dashboard.
const fmt = {
  bytes: (n) => {
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    n = Number(n) || 0;
    while (n >= 1024 && i < 4) {
      n /= 1024;
      i++;
    }
    return n.toFixed(i ? 1 : 0) + " " + u[i];
  },
  uptime: (s) => {
    s = Math.floor(s);
    const d = Math.floor(s / 86400),
      h = Math.floor((s % 86400) / 3600),
      m = Math.floor((s % 3600) / 60);
    return [d && d + "d", h && h + "h", m + "m"].filter(Boolean).join(" ");
  },
  pct: (n) => n + "%",
  ms: (n) => n + " ms",
  list: (a) => a.join(", "),
};
const get = (o, path) =>
  path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
async function refresh() {
  const els = document.querySelectorAll("[data-metric]");
  if (!els.length) return;
  try {
    const r = await fetch("/admin/health.json", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return;
    const h = await r.json();
    els.forEach((el) => {
      const v = get(h, el.dataset.metric);
      if (v === undefined) return;
      if (el.tagName === "PROGRESS") el.value = v;
      else el.textContent = (fmt[el.dataset.format] || String)(v);
    });
  } catch {
    /* offline */
  }
}
setInterval(refresh, 5000);
