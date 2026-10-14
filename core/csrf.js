import { HttpError } from "./errors.js";
import { safeEqual } from "./security.js";
import { Logger } from "./logger.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF protection for unsafe methods = (1) same-origin check + (2) per-session token.
 *
 * (1) Browsers tell us where a request came from:
 *     • Sec-Fetch-Site (unforgeable by page scripts): "same-origin"/"none" pass, "cross-site"/"same-site" are rejected.
 *       Only sent to HTTPS and localhost origins.
 *     • otherwise Origin must match Host. NOTE: a literal "Origin: null" is what browsers send for same-origin form posts
 *       under `Referrer-Policy: no-referrer`, so "null" is NOT treated as hostile — the token (2) still has to match.
 *     • no browser signals at all (curl, server-to-server): the token is the protection.
 */
export function csrf({ exempt = [] } = {}) {
  return (req, res, next) => {
    if (SAFE.has(req.method)) return next();
    const reject = (reason, message) => {
      Logger.warn("Request rejected by CSRF protection", {
        reason,
        method: req.method,
        path: req.path,
        origin: req.headers.origin,
        host: req.headers.host,
        fetchSite: req.headers["sec-fetch-site"],
      });
      return next(new HttpError(403, message));
    };

    const site = req.headers["sec-fetch-site"],
      origin = req.headers.origin;
    let sameOrigin = true;
    if (site) sameOrigin = site === "same-origin" || site === "none";
    else if (origin && origin !== "null") {
      try {
        sameOrigin = new URL(origin).host === req.headers.host;
      } catch {
        sameOrigin = false;
      }
    }
    if (!sameOrigin)
      return reject(
        "cross-site request",
        "Request blocked: it did not come from this site.",
      );

    if (exempt.some((p) => req.path.startsWith(p))) return next(); // token-free endpoints (e.g. anonymous live reactions) — still origin-checked above

    const expected = req.session.data._csrf;
    const given = req.body?._csrf || req.headers["x-csrf-token"];
    if (!expected || !given || !safeEqual(given, expected))
      return reject(
        "missing or invalid token",
        "Your session expired or this form is out of date. Please reload the page and try again.",
      );
    delete req.body._csrf;
    next();
  };
}
