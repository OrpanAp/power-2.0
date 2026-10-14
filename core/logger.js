import { db } from "./database.js";

const COLORS = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};
const SECRET = /pass|token|secret|csrf|totp|backup|code$/i;

/** Writes to console + system_logs. Returns a promise that never rejects (await it if you need ordering). */
async function write(level, message, context = {}, userId = null) {
  const safe = {};
  for (const [k, v] of Object.entries(context || {}))
    safe[k] = SECRET.test(k) ? "[redacted]" : v;
  if (process.env.NODE_ENV !== "test") {
    const ctx = Object.keys(safe).length ? " " + JSON.stringify(safe) : "";
    console.log(
      `${COLORS[level]}[${level.toUpperCase()}]\x1b[0m ${message}${ctx}`,
    );
  }
  try {
    await db.run(
      "INSERT INTO system_logs (level, message, context, user_id, created_at) VALUES (?, ?, ?, ?, ?)",
      [
        level,
        String(message).slice(0, 500),
        JSON.stringify(safe),
        userId,
        new Date().toISOString(),
      ],
    );
  } catch {
    /* table may not exist yet (pre-migration) or DB closing */
  }
}

export const Logger = {
  debug: (m, c, u) => write("debug", m, c, u),
  info: (m, c, u) => write("info", m, c, u),
  warn: (m, c, u) => write("warn", m, c, u),
  error: (m, c, u) => write("error", m, c, u),
};
