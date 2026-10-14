import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadEnvFiles, resolveEnv, findUnknown } from "./env.js";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// 1) layered .env files → process.env (real env wins)   2) typed, validated values   3) fail fast with every problem listed
const { mode, sources } = loadEnvFiles({ root: ROOT });
const { values: v, errors, warnings } = resolveEnv(process.env, { mode });
warnings.push(
  ...findUnknown(
    Object.entries(sources)
      .filter(([, s]) => s.startsWith(".env"))
      .map(([k]) => k),
  ),
);
if (errors.length)
  throw new Error(
    `Invalid environment configuration (mode "${mode}"):\n  - ${errors.join("\n  - ")}\nRun: node bin/power-cli.js env:check`,
  );
if (mode !== "test") for (const w of warnings) console.warn(`[env] ${w}`);

const isProd = mode === "production";

// Dev convenience: persist a random secret so sessions and encrypted data survive restarts. Never used in production.
function devSecret() {
  const f = path.join(ROOT, "storage/.dev-secret");
  try {
    return fs.readFileSync(f, "utf8").trim();
  } catch {
    /* create below */
  }
  const s = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, s, { mode: 0o600 });
  } catch {
    /* read-only fs */
  }
  return s;
}

// Connections: DB_URL = default; DB_<NAME>_URL = extra named connections (e.g. DB_ANALYTICS_URL=postgres://...).
function dbUrls() {
  const urls = { default: v.DB_URL || `sqlite:${v.DB_PATH}` };
  for (const [k, val] of Object.entries(process.env)) {
    const m = /^DB_([A-Z0-9]+(?:_[A-Z0-9]+)*)_URL$/.exec(k);
    if (m && val) urls[m[1].toLowerCase()] = val;
  }
  return urls;
}

export const config = Object.freeze({
  root: ROOT,
  env: mode,
  isProd,
  isDev: !isProd,
  envSources: sources,
  name: v.APP_NAME,
  host: v.HOST,
  port: v.PORT,
  secret: v.SESSION_SECRET || (isProd ? "" : devSecret()),
  pepper: v.PASSWORD_PEPPER,
  dbUrls: dbUrls(),
  dbPoolMax: v.DB_POOL_MAX,
  sessionTtlMs: v.SESSION_TTL_HOURS * 3600 * 1000, // idle timeout (sliding)
  sessionAbsoluteMs: v.SESSION_ABSOLUTE_HOURS * 3600 * 1000, // hard cap, never extended
  cookieName: isProd ? "__Host-power_sid" : "power_sid",
  allowedHosts: v.ALLOWED_HOSTS,
  forceHttps: v.FORCE_HTTPS,
  tls: v.TLS_CERT && v.TLS_KEY ? { cert: v.TLS_CERT, key: v.TLS_KEY } : null,
  maxConnections: v.MAX_CONNECTIONS,
  globalRateLimit: v.RATE_LIMIT_PER_MINUTE,
  authRateLimit: v.AUTH_RATE_LIMIT,
  require2faAdmin: v.REQUIRE_ADMIN_2FA,
  lockout: { after: 5, baseMs: 15 * 60 * 1000, maxMs: 24 * 3600 * 1000 },
  bodyLimit: v.BODY_LIMIT,
  trustProxy: v.TRUST_PROXY,
  allowRegistration: v.ALLOW_REGISTRATION,
  liveReload: mode === "development" && v.LIVE_RELOAD,
  presentations: {
    maxSlides: v.PRESENTATION_MAX_SLIDES,
    maxBytes: v.PRESENTATION_MAX_KB * 1024,
    maxPerRoom: v.PRESENTATION_MAX_VIEWERS,
    maxPerIp: v.PRESENTATION_MAX_CONN_PER_IP,
  },
  // PUBLIC_* variables are the only ones exposed to templates ({{ publicEnv.PUBLIC_FOO }}).
  publicEnv: Object.freeze(
    Object.fromEntries(
      Object.entries(process.env).filter(([k]) =>
        /^PUBLIC_[A-Z0-9_]+$/.test(k),
      ),
    ),
  ),
  paths: {
    views: path.join(ROOT, "app/views"),
    public: path.join(ROOT, "public"),
    migrations: path.join(ROOT, "database/migrations"),
    storage: path.join(ROOT, "storage"),
  },
});
