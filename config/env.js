import fs from "node:fs";
import path from "node:path";

/* =========================================================================================
 * Environment handling (zero dependencies)
 *
 * Files, lowest → highest precedence (real process env always wins over every file):
 *   .env  →  .env.<mode>  →  .env.local (not in test)  →  .env.<mode>.local
 * Syntax: KEY=value · "double" (escapes, multi-line, ${expansion}) · 'single' (literal) · `export KEY=…`
 *         ${VAR} · ${VAR:-default} · $VAR · \$ for a literal dollar · inline "  # comments"
 * Secrets from files (Docker/K8s):  SESSION_SECRET_FILE=/run/secrets/session  (used when SESSION_SECRET is unset)
 * Public values for templates:      PUBLIC_*  →  {{ publicEnv.PUBLIC_FOO }}
 * ======================================================================================= */

export const SCHEMA = {
  NODE_ENV: {
    type: "string",
    default: "development",
    desc: "Runtime mode: development | test | production (selects .env.<mode>)",
  },
  APP_NAME: {
    type: "string",
    default: "P.O.W.E.R.",
    desc: "Name shown in the UI and as the 2FA issuer",
  },
  HOST: { type: "string", default: "127.0.0.1", desc: "Interface to bind" },
  PORT: { type: "int", default: 3000, min: 0, max: 65535, desc: "HTTP port" },
  SESSION_SECRET: {
    type: "string",
    secret: true,
    minLength: 32,
    requiredInProd: true,
    desc: "Signs/derives session + encryption keys (>= 32 chars). `key:generate` makes one",
  },
  PASSWORD_PEPPER: {
    type: "string",
    secret: true,
    default: "",
    desc: "Optional server-side secret mixed into password hashes",
  },
  DB_URL: {
    type: "url",
    schemes: ["sqlite:", "postgres:", "postgresql:", "mysql:", "mariadb:"],
    default: "",
    desc: "Default database, e.g. sqlite:storage/power.sqlite or postgres://u:p@host/db?sslmode=verify-full",
    secret: true,
  },
  DB_PATH: {
    type: "string",
    default: "storage/power.sqlite",
    desc: "Legacy: SQLite path used when DB_URL is empty",
  },
  DB_POOL_MAX: {
    type: "int",
    default: 5,
    min: 1,
    max: 100,
    desc: "Max connections per PostgreSQL/MySQL pool",
  },
  SESSION_TTL_HOURS: {
    type: "int",
    default: 12,
    min: 1,
    max: 24 * 90,
    desc: "Idle session timeout (sliding)",
  },
  SESSION_ABSOLUTE_HOURS: {
    type: "int",
    default: 72,
    min: 1,
    max: 24 * 365,
    desc: "Absolute session lifetime",
  },
  BODY_LIMIT: {
    type: "int",
    default: 1048576,
    min: 1024,
    desc: "Max request body in bytes",
  },
  TRUST_PROXY: {
    type: "bool",
    default: false,
    desc: "Trust X-Forwarded-* (only behind a reverse proxy you control)",
  },
  ALLOW_REGISTRATION: {
    type: "bool",
    default: true,
    desc: "Allow public sign-ups",
  },
  LIVE_RELOAD: {
    type: "bool",
    default: true,
    desc: "Dev live reload (SSE); ignored outside development",
  },
  ALLOWED_HOSTS: {
    type: "list",
    default: [],
    recommendedInProd: true,
    desc: "Comma list of accepted Host headers",
  },
  FORCE_HTTPS: { type: "bool", default: false, desc: "Redirect http → https" },
  TLS_CERT: {
    type: "string",
    default: "",
    desc: "Path to TLS certificate (enables native HTTPS with TLS_KEY)",
  },
  TLS_KEY: {
    type: "string",
    default: "",
    secret: true,
    desc: "Path to TLS private key",
  },
  MAX_CONNECTIONS: {
    type: "int",
    default: 1000,
    min: 1,
    desc: "Max concurrent sockets",
  },
  RATE_LIMIT_PER_MINUTE: {
    type: "int",
    default: 300,
    min: 1,
    desc: "Global per-IP request limit",
  },
  AUTH_RATE_LIMIT: {
    type: "int",
    default: 20,
    min: 1,
    desc: "Login/register attempts per IP per 15 minutes",
  },
  REQUIRE_ADMIN_2FA: {
    type: "bool",
    default: false,
    desc: "Force admins to enrol TOTP",
  },
  POWER_ADMIN_EMAIL: {
    type: "string",
    default: "admin@power.local",
    desc: "Initial admin email (first boot)",
  },
  POWER_ADMIN_PASSWORD: {
    type: "string",
    secret: true,
    default: "",
    desc: "Initial admin password (random if empty)",
  },
  PRESENTATION_MAX_SLIDES: {
    type: "int",
    default: 200,
    min: 1,
    max: 2000,
    desc: "Max slides per deck",
  },
  PRESENTATION_MAX_KB: {
    type: "int",
    default: 200,
    min: 1,
    max: 5000,
    desc: "Max deck Markdown size (KB)",
  },
  PRESENTATION_MAX_VIEWERS: {
    type: "int",
    default: 2000,
    min: 1,
    desc: "Max live audience connections per deck",
  },
  PRESENTATION_MAX_CONN_PER_IP: {
    type: "int",
    default: 10,
    min: 1,
    desc: "Max live connections per IP",
  },
};
const ALWAYS_OK =
  /^(DB_[A-Z0-9_]+_URL|PUBLIC_[A-Z0-9_]+|[A-Z0-9_]+_FILE|npm_.*|PATH|HOME|PWD|SHELL|USER|LANG|TERM|TMPDIR|CI|NODE_.*)$/;

/* ---------- .env parsing ---------- */
const LINE =
  /^[ \t]*(?:export[ \t]+)?([A-Za-z_][\w.]*)[ \t]*=[ \t]*("(?:\\[\s\S]|[^"\\])*"|'[^']*'|[^\n]*)/gm;

function expand(str, lookup, depth = 0) {
  return str.replace(
    /\\\$|\$\{([A-Za-z_]\w*)(?::-([^}]*))?\}|\$([A-Za-z_]\w*)/g,
    (m, braced, dflt, bare) => {
      if (m === "\\$") return "$";
      const v = lookup(braced || bare);
      return v !== undefined && v !== ""
        ? v
        : dflt !== undefined
          ? depth < 5
            ? expand(dflt, lookup, depth + 1)
            : dflt
          : "";
    },
  );
}

/** Parse .env text → Map(key → value). `lookup` resolves ${VAR} references not defined earlier in the same file. */
export function parseDotenv(text, lookup = () => undefined) {
  const out = new Map();
  const look = (k) => (out.has(k) ? out.get(k) : lookup(k));
  for (const m of String(text).replace(/\r\n?/g, "\n").matchAll(LINE)) {
    const [, key, raw] = m;
    let val;
    if (raw.length >= 2 && raw[0] === '"' && raw.endsWith('"')) {
      val = expand(
        raw
          .slice(1, -1)
          .replace(
            /\\([nrt"\\])/g,
            (_, c) => ({ n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" })[c],
          ),
        look,
      );
    } else if (raw.length >= 2 && raw[0] === "'" && raw.endsWith("'")) {
      val = raw.slice(1, -1);
    } else {
      val = expand(raw.replace(/\s+#.*$/, "").trim(), look);
    }
    out.set(key, val);
  }
  return out;
}

/**
 * Load layered env files into `env` (default process.env). Real environment variables are never overwritten.
 * Returns { mode, sources } where sources maps KEY → 'process' | '<file name>'.
 */
export function loadEnvFiles({ root, env = process.env, mode } = {}) {
  const original = new Set(Object.keys(env));
  const read = (f) => {
    try {
      return fs.readFileSync(path.join(root, f), "utf8");
    } catch {
      return null;
    }
  };
  // NODE_ENV may itself live in .env — peek at the base files first.
  mode ||=
    env.NODE_ENV ||
    parseDotenv(read(".env") || "").get("NODE_ENV") ||
    parseDotenv(read(".env.local") || "").get("NODE_ENV") ||
    "development";
  const files = [
    ".env",
    `.env.${mode}`,
    ...(mode === "test" ? [] : [".env.local"]),
    `.env.${mode}.local`,
  ];
  const merged = {},
    sources = {};
  for (const f of files) {
    const text = read(f);
    if (text === null) continue;
    for (const [k, v] of parseDotenv(text, (name) =>
      original.has(name) ? env[name] : merged[name],
    )) {
      merged[k] = v;
      sources[k] = f;
    }
  }
  for (const [k, v] of Object.entries(merged)) if (!original.has(k)) env[k] = v;
  if (!original.has("NODE_ENV") && !("NODE_ENV" in merged)) env.NODE_ENV = mode;
  for (const k of original) sources[k] = "process";

  // KEY_FILE=/path → KEY (Docker/Kubernetes secrets) for known settings. Only when KEY itself is not set.
  for (const k of Object.keys(env)) {
    const m = /^([A-Z][A-Z0-9_]*)_FILE$/.exec(k);
    // Only the framework's own settings (never unrelated tools' variables such as PIP_CONFIG_FILE).
    if (
      m &&
      (m[1] in SCHEMA || /^DB_[A-Z0-9]+(?:_[A-Z0-9]+)*_URL$/.test(m[1])) &&
      !env[m[1]] &&
      env[k]
    ) {
      try {
        env[m[1]] = fs.readFileSync(env[k], "utf8").replace(/\r?\n$/, "");
        sources[m[1]] = `file:${env[k]}`;
      } catch (e) {
        throw new Error(
          `${k}: cannot read "${env[k]}" (${e.code || e.message})`,
        );
      }
    }
  }
  return { mode, sources };
}

/* ---------- typed values + validation ---------- */
const TRUE = new Set(["1", "true", "yes", "on"]),
  FALSE = new Set(["0", "false", "no", "off"]);
function coerce(def, raw) {
  switch (def.type) {
    case "int": {
      if (!/^-?\d+$/.test(raw)) return { err: `"${raw}" is not an integer` };
      const n = Number(raw);
      if (def.min !== undefined && n < def.min)
        return { err: `must be >= ${def.min}` };
      if (def.max !== undefined && n > def.max)
        return { err: `must be <= ${def.max}` };
      return { value: n };
    }
    case "bool": {
      const v = raw.toLowerCase();
      return TRUE.has(v)
        ? { value: true }
        : FALSE.has(v)
          ? { value: false }
          : {
              err: `"${raw}" is not a boolean (use true/false/1/0/yes/no/on/off)`,
            };
    }
    case "list":
      return {
        value: raw
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      };
    case "url": {
      if (
        def.schemes &&
        !def.schemes.some((s) => raw.toLowerCase().startsWith(s))
      )
        return { err: `must start with ${def.schemes.join(" ")}` };
      return { value: raw };
    }
    default:
      if (def.minLength && raw.length < def.minLength)
        return {
          err: `must be at least ${def.minLength} characters (got ${raw.length})`,
        };
      return { value: raw };
  }
}

export function resolveEnv(
  env = process.env,
  { schema = SCHEMA, mode = env.NODE_ENV || "development" } = {},
) {
  const values = {},
    errors = [],
    warnings = [];
  const prod = mode === "production";
  for (const [key, def] of Object.entries(schema)) {
    const raw = env[key];
    if (raw === undefined || raw === "") {
      if (def.required || (def.requiredInProd && prod))
        errors.push(
          `${key} is required${def.required ? "" : " in production"}${def.desc ? ` — ${def.desc}` : ""}`,
        );
      else if (def.recommendedInProd && prod)
        warnings.push(
          `${key} is not set — recommended in production (${def.desc})`,
        );
      values[key] = def.default ?? "";
      continue;
    }
    const r = coerce(def, raw);
    if (r.err) {
      errors.push(`${key}: ${r.err}`);
      values[key] = def.default ?? "";
    } else values[key] = r.value;
  }
  return { values, errors, warnings };
}

const lev = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array(b.length).fill(0),
  ]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[a.length][b.length];
};
/** Variables defined in .env files that no part of the framework reads — usually typos. */
export function findUnknown(fileKeys, schema = SCHEMA) {
  const known = Object.keys(schema);
  return fileKeys
    .filter((k) => !(k in schema) && !ALWAYS_OK.test(k))
    .map((k) => {
      const near = known.find((s) => lev(k, s) <= 2);
      return `${k} is not a known setting${near ? ` — did you mean ${near}?` : ""}`;
    });
}

export const maskValue = (def, v) =>
  def?.secret && v !== "" && v !== undefined
    ? `•••••••• (${String(v).length} chars)`
    : Array.isArray(v)
      ? v.join(",")
      : String(v ?? "");

/** Rows for `env:check`: every schema key with its resolved value, where it came from and any problem. */
export function describeEnv({ root, mode, env = { ...process.env } } = {}) {
  const { mode: m, sources } = loadEnvFiles({ root, env, mode });
  const { values, errors, warnings } = resolveEnv(env, { mode: m });
  const fileKeys = Object.entries(sources)
    .filter(([, s]) => s.startsWith(".env"))
    .map(([k]) => k);
  warnings.push(...findUnknown(fileKeys));
  const rows = Object.entries(SCHEMA).map(([key, def]) => ({
    key,
    value: maskValue(def, values[key]),
    source: sources[key] || "default",
    desc: def.desc,
  }));
  return { mode: m, rows, errors, warnings };
}

/* ---------- writing ---------- */
const fmt = (v) =>
  /^[\w@%+=:,./-]*$/.test(v)
    ? v
    : `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\$/g, "\\$")}"`;
/** Set/replace KEY in an env file, preserving everything else. New .local files are created with mode 0600. */
export function setEnvVar(file, key, value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
    throw new Error(`Invalid variable name: ${key}`);
  const exists = fs.existsSync(file);
  const lines = exists ? fs.readFileSync(file, "utf8").split("\n") : [];
  const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
  const line = `${key}=${fmt(String(value))}`;
  const i = lines.findIndex((l) => re.test(l));
  if (i >= 0) lines[i] = line;
  else {
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push(line, "");
  }
  fs.writeFileSync(file, lines.join("\n"), {
    mode: exists ? undefined : 0o600,
  });
}
export function exampleFile() {
  const out = [
    "# P.O.W.E.R. configuration — copy to .env (or .env.local / .env.production) and edit.",
    "# Layers: .env < .env.<mode> < .env.local < .env.<mode>.local < real environment",
    "# ${VAR} and ${VAR:-default} expansion is supported; KEY_FILE=/path reads a secret from a file.",
    "",
  ];
  for (const [k, d] of Object.entries(SCHEMA)) {
    out.push(
      `# ${d.desc}${d.requiredInProd ? " (required in production)" : ""}`,
    );
    const dv = Array.isArray(d.default) ? d.default.join(",") : d.default;
    out.push(
      d.secret || dv === "" || dv === undefined ? `# ${k}=` : `# ${k}=${dv}`,
      "",
    );
  }
  out.push(
    "# Extra database connections:",
    "# DB_ANALYTICS_URL=postgres://user:pass@host:5432/analytics?sslmode=verify-full",
    "",
    "# Values exposed to templates as {{ publicEnv.NAME }} (never put secrets here):",
    "# PUBLIC_ANALYTICS_ID=",
    "",
  );
  return out.join("\n");
}

/* ---------- accessor for app code ---------- */
export function env(key, fallback) {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
}
env.int = (k, d) => {
  const v = process.env[k];
  return v && /^-?\d+$/.test(v) ? Number(v) : d;
};
env.bool = (k, d = false) => {
  const v = (process.env[k] || "").toLowerCase();
  return TRUE.has(v) ? true : FALSE.has(v) ? false : d;
};
env.list = (k, d = []) =>
  process.env[k]
    ? process.env[k]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : d;
env.required = (k) => {
  const v = process.env[k];
  if (v === undefined || v === "")
    throw new Error(`Missing required environment variable ${k}`);
  return v;
};
