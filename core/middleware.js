import { HttpError } from "./errors.js";

export function securityHeaders(config) {
  const csp =
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
    "connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'";
  const cspProd = csp + "; upgrade-insecure-requests"; // only where HTTPS is expected (would break plain-http dev)
  return (req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      config.isProd || config.forceHttps ? cspProd : csp,
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    // same-origin (not no-referrer): no-referrer makes browsers send "Origin: null" on same-origin form posts.
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    );
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    res.setHeader("Origin-Agent-Cluster", "?1");
    if (config.isProd || config.forceHttps)
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=63072000; includeSubDomains; preload",
      );
    next();
  };
}

/** Rejects unknown Host headers (host-header injection / cache poisoning) and optionally forces HTTPS. */
export function hostGuard(config) {
  const allowed = new Set(config.allowedHosts);
  return (req, res, next) => {
    const host = String(req.headers.host || "").toLowerCase();
    if (
      allowed.size &&
      !allowed.has(host) &&
      !allowed.has(host.replace(/:\d+$/, ""))
    )
      return next(new HttpError(400, "Invalid Host header"));
    if (!host) return next(new HttpError(400, "Missing Host header"));
    if (config.forceHttps && !req.secure) {
      res.statusCode = 308;
      res.setHeader("Location", `https://${host}${req.originalUrl}`);
      res.setHeader("Content-Length", 0);
      return res.end();
    }
    next();
  };
}

/** Fixed-window in-memory rate limiter. Per-IP; `perPath` also scopes by route. (Single process only.) */
export function rateLimit({
  windowMs = 15 * 60 * 1000,
  max = 10,
  perPath = true,
  message = "Too many requests. Please try again later.",
} = {}) {
  const hits = new Map();
  setInterval(
    () => {
      const now = Date.now();
      for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    },
    Math.min(windowMs, 60000),
  ).unref();
  return (req, res, next) => {
    const now = Date.now(),
      key = perPath ? `${req.ip}|${req.path}` : req.ip;
    let h = hits.get(key);
    if (!h || h.reset <= now) {
      h = { n: 0, reset: now + windowMs };
      hits.set(key, h);
    }
    if (hits.size > 100000) hits.clear(); // memory-exhaustion guard
    if (++h.n > max) {
      res.setHeader("Retry-After", Math.ceil((h.reset - now) / 1000));
      return next(new HttpError(429, message));
    }
    next();
  };
}
