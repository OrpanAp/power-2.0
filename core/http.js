import { sanitizeInput } from "./security.js";
import { HttpError } from "./errors.js";

const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".xml": "application/xml",
};

export function parseCookies(header = "") {
  const out = Object.create(null);
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || BAD_KEYS.has(k)) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* ignore malformed */
    }
  }
  return out;
}
export function parseQuery(search = "") {
  const out = Object.create(null);
  let n = 0;
  for (const [k, v] of new URLSearchParams(search)) {
    if (++n > 1000) throw new HttpError(400, "Too many parameters");
    if (BAD_KEYS.has(k)) continue;
    out[k] = k in out ? [].concat(out[k], v) : v;
  }
  return out;
}
export const wantsJson = (req) =>
  (req.headers.accept || "").includes("application/json") ||
  req.path.startsWith("/api/");
const safeLocal = (u) => typeof u === "string" && /^\/(?![/\\])/.test(u);

/** Decorate Node's req/res with Express-style helpers. */
export function augment(req, res, app) {
  req.app = app;
  req.originalUrl = req.url || "/";
  const raw = req.originalUrl,
    qi = raw.indexOf("?");
  if (raw.length > 8192) {
    req.path = null;
    return;
  }
  let p = (qi < 0 ? raw : raw.slice(0, qi)).replace(/^\/+/, "/");
  try {
    p = decodeURIComponent(p);
  } catch {
    p = null;
  }
  req.path = p;
  try {
    req.query = sanitizeInput(parseQuery(qi < 0 ? "" : raw.slice(qi + 1)));
  } catch {
    req.query = Object.create(null);
    req.badQuery = true;
  }
  req.cookies = parseCookies(req.headers.cookie);
  req.params = Object.create(null);
  req.body = Object.create(null);
  req.secure =
    !!req.socket.encrypted ||
    (app.config.trustProxy && req.headers["x-forwarded-proto"] === "https");
  req.ip =
    (app.config.trustProxy &&
      String(req.headers["x-forwarded-for"] || "")
        .split(",")[0]
        .trim()) ||
    req.socket.remoteAddress ||
    "";

  res.locals = {};
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.set = (k, v) => {
    res.setHeader(k, v);
    return res;
  };
  res.cookie = (name, value, o = {}) => {
    const parts = [
      `${name}=${encodeURIComponent(value)}`,
      `Path=${o.path || "/"}`,
    ];
    if (o.maxAge != null) parts.push(`Max-Age=${Math.floor(o.maxAge / 1000)}`);
    if (o.httpOnly !== false) parts.push("HttpOnly");
    parts.push(`SameSite=${o.sameSite || "Lax"}`);
    if (o.secure ?? (app.config.isProd || req.secure)) parts.push("Secure");
    res.setHeader(
      "Set-Cookie",
      [].concat(res.getHeader("Set-Cookie") || [], parts.join("; ")),
    );
    return res;
  };
  res.clearCookie = (name) => res.cookie(name, "", { maxAge: 0 });
  res.send = (body, type = "text/html; charset=utf-8") => {
    const buf = Buffer.from(body ?? "");
    if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", type);
    if (!res.getHeader("Cache-Control"))
      res.setHeader("Cache-Control", "no-store"); // dynamic responses are never cached
    res.setHeader("Content-Length", buf.length);
    res.end(req.method === "HEAD" ? undefined : buf);
  };
  res.html = (body) => res.send(body, "text/html; charset=utf-8");
  res.text = (body) => res.send(body, "text/plain; charset=utf-8");
  res.json = (obj) =>
    res.send(JSON.stringify(obj), "application/json; charset=utf-8");
  res.redirect = (url, code) => {
    if (!safeLocal(url))
      throw new Error(`Refusing to redirect to non-local URL: ${url}`);
    res.statusCode = code || (["GET", "HEAD"].includes(req.method) ? 302 : 303);
    res.setHeader("Location", url);
    res.setHeader("Content-Length", 0);
    res.end();
  };
  res.back = (fallback = "/") => {
    try {
      const u = new URL(req.headers.referer || "");
      if (u.host === req.headers.host)
        return res.redirect(u.pathname + u.search);
    } catch {
      /* no referer */
    }
    return res.redirect(fallback);
  };
  /** Flash validation errors + old input, then redirect. */
  res.invalid = (errors, old, to) => {
    req.session.flash("errors", errors);
    req.session.flash("old", old || {});
    return to ? res.redirect(to) : res.back("/");
  };
  res.render = (view, data = {}) =>
    res.html(app.views.render(view, app.buildContext(req, res, data)));
}
