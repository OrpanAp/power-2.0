import { HttpError } from "./errors.js";

export const REACTIONS = ["clap", "heart", "wow", "laugh", "thumbs"];

/**
 * In-memory real-time hub for live presentations (Server-Sent Events).
 * One "room" per deck slug: presenter state (status/slide index), audience count, reaction totals.
 * Single-process by design — run one instance, or put a shared pub/sub in front for horizontal scaling.
 */
export class LiveHub {
  constructor({ maxPerRoom = 2000, maxPerIp = 10 } = {}) {
    this.maxPerRoom = maxPerRoom;
    this.maxPerIp = maxPerIp;
    this.rooms = new Map();
    this.perIp = new Map();
    this.beat = setInterval(() => {
      for (const r of this.rooms.values())
        for (const c of r.clients) this._raw(c, ": ping\n\n");
    }, 20000);
    this.beat.unref();
  }

  room(slug) {
    let r = this.rooms.get(slug);
    if (!r) {
      r = {
        slug,
        status: "idle",
        index: 0,
        total: 0,
        startedAt: null,
        v: 1,
        counts: {},
        clients: new Set(),
        timer: null,
      };
      this.rooms.set(slug, r);
    }
    return r;
  }
  statusOf(slug) {
    const r = this.rooms.get(slug);
    return r
      ? { status: r.status, viewers: this.viewers(r) }
      : { status: "idle", viewers: 0 };
  }
  viewers(r) {
    let n = 0;
    for (const c of r.clients) if (!c.presenter) n++;
    return n;
  }
  snapshot(r) {
    return {
      status: r.status,
      index: r.index,
      total: r.total,
      startedAt: r.startedAt,
      viewers: this.viewers(r),
      reactions: r.counts,
      v: r.v,
    };
  }

  _raw(c, text) {
    try {
      c.res.write(text);
    } catch {
      /* socket gone; cleanup runs on 'close' */
    }
  }
  _send(c, event, data) {
    this._raw(c, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  broadcast(r, event, data) {
    for (const c of r.clients) this._send(c, event, data);
  }
  _viewersSoon(r) {
    if (r.timer) return;
    r.timer = setTimeout(() => {
      r.timer = null;
      this.broadcast(r, "viewers", { count: this.viewers(r) });
    }, 800);
    r.timer.unref?.();
  }
  _gc(r) {
    if (!r.clients.size && r.status !== "live") {
      clearTimeout(r.timer);
      this.rooms.delete(r.slug);
    }
  }

  /** Open an SSE stream. Throws HttpError (before any bytes are written) when limits are hit. */
  join(req, res, slug, { presenter = false, total = 0 } = {}) {
    const r = this.room(slug);
    if (total) r.total = total;
    if (!presenter && this.viewers(r) >= this.maxPerRoom)
      throw new HttpError(
        503,
        "This presentation is full. Please try again shortly.",
      );
    const n = this.perIp.get(req.ip) || 0;
    if (n >= this.maxPerIp)
      throw new HttpError(
        429,
        "Too many open live connections from your address.",
      );
    this.perIp.set(req.ip, n + 1);

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const c = { res, ip: req.ip, presenter, gone: false };
    r.clients.add(c);
    res.write("retry: 2000\n\n");
    this._send(c, "state", this.snapshot(r));
    this._viewersSoon(r);
    const leave = () => {
      if (c.gone) return;
      c.gone = true;
      r.clients.delete(c);
      const k = (this.perIp.get(c.ip) || 1) - 1;
      if (k > 0) this.perIp.set(c.ip, k);
      else this.perIp.delete(c.ip);
      this._viewersSoon(r);
      this._gc(r);
    };
    req.on("close", leave);
    res.on("error", leave);
  }

  /** Presenter controls. Returns the new snapshot; throws HttpError on invalid input. */
  control(slug, { action, index }, total) {
    const r = this.room(slug);
    r.total = total;
    switch (action) {
      case "start":
        if (r.status !== "live") {
          r.startedAt = Date.now();
          r.counts = {};
          if (r.status === "ended") r.index = 0;
        }
        r.status = "live";
        break;
      case "goto": {
        if (r.status !== "live")
          throw new HttpError(409, "Start the presentation first");
        if (!Number.isInteger(index))
          throw new HttpError(400, "index must be an integer");
        r.index = Math.min(Math.max(index, 0), Math.max(total - 1, 0));
        break;
      }
      case "end":
        r.status = "ended";
        break;
      case "reset":
        r.status = "idle";
        r.index = 0;
        r.startedAt = null;
        r.counts = {};
        break;
      default:
        throw new HttpError(400, "Unknown action");
    }
    r.v++;
    this.broadcast(r, "state", this.snapshot(r));
    this._gc(r);
    return this.snapshot(r);
  }
  react(slug, kind) {
    const r = this.rooms.get(slug);
    if (!REACTIONS.includes(kind)) throw new HttpError(400, "Unknown reaction");
    if (!r || r.status !== "live")
      throw new HttpError(409, "The presentation is not live");
    r.counts[kind] = (r.counts[kind] || 0) + 1;
    this.broadcast(r, "reaction", { kind, counts: r.counts });
  }
  /** The deck was edited: tell clients to refetch, clamp the slide index. */
  contentChanged(slug, total) {
    const r = this.rooms.get(slug);
    if (!r) return;
    r.total = total;
    r.index = Math.min(r.index, Math.max(total - 1, 0));
    r.v++;
    this.broadcast(r, "content", { v: r.v });
    this.broadcast(r, "state", this.snapshot(r));
  }
  close(slug) {
    const r = this.rooms.get(slug);
    if (!r) return;
    this.broadcast(r, "closed", {});
    for (const c of [...r.clients]) {
      try {
        c.res.end();
      } catch {
        /* ignore */
      }
    }
    this.rooms.delete(slug);
  }
  stop() {
    clearInterval(this.beat);
    for (const s of [...this.rooms.keys()]) this.close(s);
  }
}
