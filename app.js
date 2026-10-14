import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { config } from "./config/config.js";
import { db, manager } from "./core/database.js";
import { Migrator } from "./core/migrator.js";
import { PowerApp } from "./core/server.js";
import { ViewEngine } from "./core/view.js";
import { serveStatic } from "./core/static.js";
import { bodyParser } from "./core/body.js";
import { SessionStore, sessionMiddleware } from "./core/session.js";
import { csrf } from "./core/csrf.js";
import { securityHeaders, hostGuard, rateLimit } from "./core/middleware.js";
import { LiveReload } from "./core/livereload.js";
import { LiveHub } from "./core/live.js";
import { Logger } from "./core/logger.js";
import { auth } from "./app/auth.js";
import { webRoutes } from "./app/routes/web.js";
import { adminRoutes } from "./app/routes/admin.js";
import { presentationRoutes } from "./app/routes/presentations.js";
import { siteRoutes } from "./app/routes/site.js";
import { SiteController } from "./app/controllers/SiteController.js";
import { seed } from "./database/seed.js";

/** Zero-config boot: run pending migrations (all connections), seed the first admin + demo deck. */
export async function prepareDatabase({ quiet = false } = {}) {
  const ran = await new Migrator(db, config.paths.migrations).migrate();
  // Extra connections keep their own migrations in database/migrations/<connection>/ (if that folder exists).
  for (const name of manager.names().filter((n) => n !== "default")) {
    const dir = `${config.paths.migrations}/${name}`;
    if (existsSync(dir))
      ran.push(
        ...(await new Migrator(manager.connection(name), dir).migrate()).map(
          (m) => `${name}:${m}`,
        ),
      );
  }
  if (ran.length && !quiet) console.log(`[db] migrated: ${ran.join(", ")}`);
  await seed({ quiet });
}

export function createApp() {
  const views = new ViewEngine(config.paths.views, { cache: config.isProd });
  const app = new PowerApp({ config, views });
  app.hub = new LiveHub(config.presentations); // real-time channel for live presentations
  app.locals.publicEnv = config.publicEnv; // PUBLIC_* variables only
  // Live-stream demo: one broadcast per second, only while someone is watching
  app.demoTicker = setInterval(() => {
    const r = app.hub.rooms.get("__ticker");
    if (r && r.clients.size)
      app.hub.broadcast(r, "tick", SiteController.metrics(app));
  }, 1000);
  app.demoTicker.unref();

  app.use(securityHeaders(config));
  app.use(hostGuard(config));
  app.use(
    serveStatic(config.paths.public, { maxAge: config.isProd ? 86400 : 0 }),
  );

  if (config.liveReload) {
    app.live = new LiveReload([config.paths.views, config.paths.public]);
    app.use("/__power", app.live.middleware());
    app.locals.liveReload = '<script src="/__power/livereload.js"></script>';
  }

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: config.globalRateLimit,
      perPath: false,
    }),
  );
  app.use(bodyParser({ limit: config.bodyLimit }));
  app.use(
    sessionMiddleware(
      new SessionStore(config.secret, {
        idleMs: config.sessionTtlMs,
        absoluteMs: config.sessionAbsoluteMs,
      }),
      { cookieName: config.cookieName },
    ),
  );
  app.use(auth.loadUser);
  app.use(csrf({ exempt: ["/live/", "/demo/api/"] })); // anonymous, stateless endpoints (live reactions, demo calculators): origin-checked + rate-limited

  siteRoutes(app);
  webRoutes(app);
  adminRoutes(app);
  presentationRoutes(app);
  return app;
}

/** Dev only: remind where to find the admin login every time the server starts. */
async function adminHint(addr) {
  try {
    const { User } = await import("./app/models/User.js");
    const admins = await User.all(
      { role: "admin" },
      { orderBy: "id", limit: 3 },
    );
    if (!admins.length) return;
    console.log(
      `\n  ➜ Open  http://${addr.address === "0.0.0.0" ? "localhost" : addr.address}:${addr.port}/login`,
    );
    for (const a of admins)
      console.log(
        `  ➜ Admin ${a.email}${a.last_login_at ? "" : "   (never signed in yet)"}`,
      );
    console.log(
      "  ➜ Forgot the password?  node bin/power-cli.js admin:info   (or  user:reset-password)\n",
    );
  } catch {
    /* migrations not run yet */
  }
}

export async function boot(opts = {}) {
  await prepareDatabase(opts);
  return createApp();
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const app = await boot();
  const addr = await app.listen();
  app.live?.start();
  if (!config.isProd) await adminHint(addr);
  Logger.info(`P.O.W.E.R. listening on http://${addr.address}:${addr.port}`, {
    env: config.env,
    liveReload: !!app.live,
  });
  const stop = async () => {
    app.live?.stop();
    clearInterval(app.demoTicker);
    app.hub.stop();
    await app.close();
    await manager.closeAll();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
