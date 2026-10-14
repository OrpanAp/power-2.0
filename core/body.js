import { HttpError } from "./errors.js";
import { sanitizeInput } from "./security.js";
import { parseQuery } from "./http.js";

/** JSON + urlencoded body parser with size limit, sanitization and _method override (PUT/PATCH/DELETE from HTML forms). */
export function bodyParser({ limit = 1024 * 1024 } = {}) {
  return async (req, res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    const type = (req.headers["content-type"] || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const fail = (e) => {
      res.setHeader("Connection", "close");
      next(e);
    };
    if (Number(req.headers["content-length"] || 0) > limit)
      return fail(new HttpError(413, "Payload too large"));
    if (type.startsWith("multipart/"))
      return fail(
        new HttpError(
          415,
          "multipart/form-data is not supported; use JSON or urlencoded forms",
        ),
      );

    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > limit) return fail(new HttpError(413, "Payload too large"));
      chunks.push(c);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    try {
      if (type === "application/json") {
        const j = raw ? JSON.parse(raw) : {};
        req.body =
          j && typeof j === "object" && !Array.isArray(j)
            ? sanitizeInput(j)
            : Object.create(null);
      } else if (type === "application/x-www-form-urlencoded") {
        req.body = sanitizeInput(parseQuery(raw));
      } else req.rawBody = raw;
    } catch {
      return next(new HttpError(400, "Malformed request body"));
    }

    const override = req.body._method;
    if (
      req.method === "POST" &&
      typeof override === "string" &&
      ["PUT", "PATCH", "DELETE"].includes(override.toUpperCase())
    ) {
      req.method = override.toUpperCase();
    }
    delete req.body._method;
    next();
  };
}
