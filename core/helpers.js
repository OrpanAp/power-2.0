/** Template helpers: callable from templates, e.g. {{ fmtDate(user.created_at) }} */
export const helpers = {
  fmtDate(v) {
    if (!v) return "—";
    const d = new Date(v);
    return Number.isNaN(d.getTime())
      ? String(v)
      : d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  },
  fmtBytes(n) {
    n = Number(n) || 0;
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
  },
  fmtUptime(s) {
    s = Math.floor(Number(s) || 0);
    const d = Math.floor(s / 86400),
      h = Math.floor((s % 86400) / 3600),
      m = Math.floor((s % 3600) / 60);
    return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(" ");
  },
  truncate: (s, n = 80) => {
    s = String(s ?? "");
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  },
  json: (v) => JSON.stringify(v, null, 2),
  entries: (o) => Object.entries(o || {}),
  selected: (a, b) => (String(a) === String(b) ? "selected" : ""),
  checked: (c) => (c ? "checked" : ""),
  cap: (s) => {
    s = String(s ?? "");
    return s.charAt(0).toUpperCase() + s.slice(1);
  },
};

export function buildPager(result, req) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query))
    if (k !== "page" && typeof v === "string") q.set(k, v);
  const mk = (p) => {
    const c = new URLSearchParams(q);
    c.set("page", p);
    return `${req.path}?${c}`;
  };
  return {
    page: result.page,
    pages: result.pages,
    total: result.total,
    prev: result.page > 1 ? mk(result.page - 1) : null,
    next: result.page < result.pages ? mk(result.page + 1) : null,
  };
}
