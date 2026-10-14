import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import { Router } from "./router.js";
import { augment, wantsJson } from "./http.js";
import { helpers } from "./helpers.js";
import { HttpError } from "./errors.js";
import { Logger } from "./logger.js";

/** The P.O.W.E.R. application: an HTTP server + router + view engine. */
export class PowerApp extends Router {
  constructor({ config, views }) {
    super();
    this.config = config;
    this.views = views;
    this.locals = {
      appName: config.name,
      isDev: config.isDev,
      liveReload: "",
      ...helpers,
    };
    this.stats = { started: Date.now(), requests: 0, errors: 0, totalMs: 0 };
    const handler = (req, res) => this._onRequest(req, res);
    const limits = { maxHeaderSize: 16 * 1024 };
    this.server = config.tls
      ? https.createServer(
          {
            ...limits,
            key: fs.readFileSync(config.tls.key),
            cert: fs.readFileSync(config.tls.cert),
            minVersion: "TLSv1.2",
          },
          handler,
        )
      : http.createServer(limits, handler);
    Object.assign(this.server, {
      requestTimeout: 30000,
      headersTimeout: 15000,
      keepAliveTimeout: 5000,
      maxHeadersCount: 100,
      maxConnections: config.maxConnections,
    });
  }

  /** Template context: app locals < res.locals < render data. Session-dependent values are lazy. */
  buildContext(req, res, data) {
    const f = req.session?.flashed || {};
    const ctx = {
      ...this.locals,
      user: req.user || null,
      path: req.path,
      query: req.query,
      flash: f,
      errors: f.errors || {},
      old: f.old || {},
      ...res.locals,
      ...data,
    };
    Object.defineProperty(ctx, "csrfToken", {
      enumerable: true,
      get: () => req.session.csrfToken(),
    });
    Object.defineProperty(ctx, "csrfField", {
      enumerable: true,
      get: () =>
        `<input type="hidden" name="_csrf" value="${req.session.csrfToken()}">`,
    });
    return ctx;
  }

  _onRequest(req, res) {
    const t0 = process.hrtime.bigint();
    augment(req, res, this);
    res.on("finish", () => {
      this.stats.requests++;
      this.stats.totalMs += Number(process.hrtime.bigint() - t0) / 1e6;
      if (res.statusCode >= 500) this.stats.errors++;
    });
    if (req.path === null || req.path.includes("\0") || req.badQuery) {
      res.statusCode = 400;
      return res.end("Bad Request");
    }
    this.handle(req, res, (err) => this._final(err, req, res));
  }

  _final(err, req, res) {
    if (res.headersSent) return res.destroy();
    if (!err) err = new HttpError(404, "Page not found");
    const status =
      err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500)
      Logger.error(
        err.message,
        {
          path: req.path,
          method: req.method,
          stack: this.config.isDev ? err.stack : undefined,
        },
        req.user?.id ?? null,
      );
    const message =
      status < 500 || err.expose || this.config.isDev
        ? err.message
        : "Something went wrong on our side.";
    res.statusCode = status;
    if (wantsJson(req))
      return res.json({
        error: message,
        status,
        details: err.details || undefined,
      });
    try {
      res.render("errors/error", {
        title: `Error ${status}`,
        status,
        message,
        stack: this.config.isDev && status >= 500 ? err.stack : "",
      });
    } catch {
      res.text(`${status} ${message}`);
    }
  }

  listen(port = this.config.port, host = this.config.host) {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, host, () => resolve(this.server.address()));
    });
  }
  close() {
    return new Promise((r) => {
      this.server.closeAllConnections?.();
      this.server.close(() => r());
    });
  }
}
