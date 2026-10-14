import fs from "node:fs";
import path from "node:path";
import { MIME } from "./http.js";

/** Static file middleware: traversal-safe, dotfile-blocking, ETag + 304, streams. Falls through (next) if not found. */
export function serveStatic(dir, { maxAge = 0 } = {}) {
  const root = path.resolve(dir);
  let rootReal = root;
  try {
    rootReal = fs.realpathSync(root);
  } catch {
    /* created later */
  }
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const rel = req.path;
    if (
      !rel ||
      rel.endsWith("/") ||
      rel.includes("\0") ||
      rel.split("/").some((s) => s.startsWith("."))
    )
      return next();
    const file = path.join(root, rel);
    if (!file.startsWith(root + path.sep)) return next();
    fs.realpath(file, (rerr, real) => {
      if (rerr || !real.startsWith(rootReal + path.sep)) return next(); // blocks symlink escapes
      fs.stat(real, (err, st) => {
        if (err || !st.isFile()) return next();
        const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
        res.setHeader("ETag", etag);
        res.setHeader(
          "Cache-Control",
          maxAge ? `public, max-age=${maxAge}` : "no-cache",
        );
        if (req.headers["if-none-match"] === etag) {
          res.statusCode = 304;
          return res.end();
        }
        res.setHeader(
          "Content-Type",
          MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
        );
        res.setHeader("Content-Length", st.size);
        if (req.method === "HEAD") return res.end();
        fs.createReadStream(real)
          .on("error", () => res.destroy())
          .pipe(res);
      });
    });
  };
}
