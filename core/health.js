import os from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { db, manager } from "./database.js";
import { config } from "../config/config.js";

const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();

export async function collectHealth(app) {
  const mem = process.memoryUsage();
  const conns = [];
  for (const name of manager.names()) {
    const c = manager.connection(name);
    conns.push({ name, driver: c.dialect, ok: await c.ping() });
  }
  const dbOk = conns.find((c) => c.name === "default")?.ok ?? false;
  let tables = 0;
  try {
    tables = (await db.tables()).length;
  } catch {
    /* db down */
  }
  const info = db.info();
  const total = os.totalmem(),
    free = os.freemem();
  const s = app?.stats || { requests: 0, errors: 0, totalMs: 0 };
  return {
    status: dbOk ? "ok" : "degraded",
    time: new Date().toISOString(),
    uptime: process.uptime(),
    node: process.version,
    platform: `${os.platform()} ${os.arch()}`,
    pid: process.pid,
    env: config.env,
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      heapPct: Math.round((mem.heapUsed / mem.heapTotal) * 100),
    },
    system: {
      total,
      free,
      usedPct: Math.round(((total - free) / total) * 100),
      load: os.loadavg().map((n) => +n.toFixed(2)),
      cpus: os.cpus().length,
    },
    eventLoop: {
      meanMs: +(loop.mean / 1e6).toFixed(2),
      p99Ms: +(loop.percentile(99) / 1e6).toFixed(2),
      maxMs: +(loop.max / 1e6).toFixed(2),
    },
    database: {
      ok: dbOk,
      driver: info.driver,
      tables,
      sizeBytes: info.sizeBytes ?? 0,
      connections: conns,
    },
    http: {
      requests: s.requests,
      errors: s.errors,
      avgMs: s.requests ? +(s.totalMs / s.requests).toFixed(2) : 0,
    },
  };
}
