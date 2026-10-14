import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

export function setupEnv(extra = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "power-"));
  Object.assign(process.env, {
    NODE_ENV: "test",
    DB_URL: `sqlite:${path.join(tmp, "test.sqlite")}`,
    DB_ANALYTICS_URL: "sqlite::memory:",
    POWER_ADMIN_PASSWORD: "Adm1n-Test-Pass!",
    SESSION_SECRET: "test-secret-test-secret-test-secret-123",
    ALLOWED_HOSTS: "127.0.0.1,localhost",
    AUTH_RATE_LIMIT: "1000",
    ...extra,
  });
  return tmp;
}

export class Client {
  constructor(base, ua = "power-test") {
    this.base = base;
    this.jar = {};
    this.ua = ua;
  }
  async req(method, url, form, headers = {}) {
    const cookie = Object.entries(this.jar)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    const r = await fetch(this.base + url, {
      method,
      redirect: "manual",
      headers: {
        cookie,
        "user-agent": this.ua,
        ...(form
          ? { "content-type": "application/x-www-form-urlencoded" }
          : {}),
        ...headers,
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    this.setCookies = r.headers.getSetCookie();
    for (const sc of this.setCookies) {
      const [kv] = sc.split(";");
      const i = kv.indexOf("=");
      const v = kv.slice(i + 1);
      if (v) this.jar[kv.slice(0, i)] = v;
      else delete this.jar[kv.slice(0, i)];
    }
    return {
      status: r.status,
      loc: r.headers.get("location"),
      text: await r.text(),
      headers: r.headers,
    };
  }
  async json(method, url, obj, headers = {}) {
    const cookie = Object.entries(this.jar)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    const r = await fetch(this.base + url, {
      method,
      redirect: "manual",
      headers: {
        cookie,
        "user-agent": this.ua,
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(obj),
    });
    const text = await r.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: r.status, body, text, headers: r.headers };
  }
  cookieHeader() {
    return Object.entries(this.jar)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
  async csrf(url) {
    return (await this.req("GET", url)).text.match(
      /name="_csrf" value="([^"]+)"/,
    )?.[1];
  }
  async login(email, password) {
    const t = await this.csrf("/login");
    return this.req("POST", "/login", { _csrf: t, email, password });
  }
  async post(url, form, from = url) {
    const _csrf = await this.csrf(from);
    return this.req("POST", url, { _csrf, ...form });
  }
}

/** Raw HTTP request (lets tests set the Host header, which fetch forbids). */
export const rawRequest = (port, hostHeader, pathName = "/") =>
  new Promise((resolve, reject) => {
    const r = http.request(
      {
        host: "127.0.0.1",
        port,
        path: pathName,
        headers: { host: hostHeader },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      },
    );
    r.on("error", reject);
    r.end();
  });

/** Minimal Server-Sent-Events client for tests. */
export function openSse(port, pathName, cookie = "") {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        host: "127.0.0.1",
        port,
        path: pathName,
        headers: {
          accept: "text/event-stream",
          cookie,
          "user-agent": "power-test",
        },
      },
      (res) => {
        const sse = {
          status: res.statusCode,
          events: [],
          buf: "",
          close: () => req.destroy(),
        };
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(sse);
        }
        res.setEncoding("utf8");
        res.on("data", (d) => {
          sse.buf += d;
          let i;
          while ((i = sse.buf.indexOf("\n\n")) >= 0) {
            const block = sse.buf.slice(0, i);
            sse.buf = sse.buf.slice(i + 2);
            const ev = /^event: (.*)$/m.exec(block)?.[1],
              data = /^data: (.*)$/m.exec(block)?.[1];
            if (ev) sse.events.push({ event: ev, data: JSON.parse(data) });
          }
        });
        res.on("error", () => {});
        resolve(sse);
      },
    );
    req.on("error", reject);
  });
}
export async function waitFor(sse, pred, ms = 2500) {
  const t0 = Date.now();
  for (;;) {
    const hit = sse.events.find(pred);
    if (hit) return hit;
    if (Date.now() - t0 > ms)
      throw new Error(
        "Timed out waiting for SSE event; saw: " +
          JSON.stringify(sse.events.map((e) => e.event)),
      );
    await new Promise((r) => setTimeout(r, 20));
  }
}
