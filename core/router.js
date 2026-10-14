const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

function compile(pattern, end) {
  const keys = [];
  const segs = pattern
    .split("/")
    .filter(Boolean)
    .map((s) => {
      if (s === "*") {
        keys.push("*");
        return "(.*)";
      }
      if (s[0] === ":") {
        keys.push(s.slice(1));
        return "([^/]+)";
      }
      return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    });
  const body = segs.length ? "/" + segs.join("/") : "";
  return {
    keys,
    re: end
      ? new RegExp(`^${body}/?$`, "i")
      : new RegExp(`^${body}(?=/|$)`, "i"),
  };
}
const join = (a, b) =>
  ("/" + a + "/" + b).replace(/\/+/g, "/").replace(/(.)\/$/, "$1");

function call(fn, err, req, res, next) {
  try {
    const r = err ? fn(err, req, res, next) : fn(req, res, next);
    if (r && typeof r.then === "function") r.catch(next);
  } catch (e) {
    next(e);
  }
}

/** Express-like router: use(), get/post/put/patch/delete(), group(), :params, middleware chaining, error handlers (arity 4). */
export class Router {
  constructor() {
    this.stack = [];
  }

  use(...args) {
    let prefix = "/";
    if (typeof args[0] === "string") prefix = args.shift();
    const { re, keys } = compile(prefix, false);
    for (const fn of args.flat())
      this.stack.push({
        method: null,
        re,
        keys,
        fn,
        error: fn.length === 4,
        route: false,
      });
    return this;
  }
  route(method, pattern, ...handlers) {
    const { re, keys } = compile(pattern, true);
    for (const fn of handlers.flat()) {
      if (typeof fn !== "function")
        throw new TypeError(
          `Handler for ${method} ${pattern} is not a function`,
        );
      this.stack.push({
        method,
        re,
        keys,
        fn,
        error: false,
        route: true,
        pattern,
      });
    }
    return this;
  }
  all(pattern, ...h) {
    return this.route("*", pattern, ...h);
  }
  group(prefix, middleware, cb) {
    cb(new RouteGroup(this, prefix, [].concat(middleware || [])));
    return this;
  }

  routeList() {
    const seen = new Set(),
      out = [];
    for (const s of this.stack)
      if (s.route && !seen.has(s.method + s.pattern)) {
        seen.add(s.method + s.pattern);
        out.push({ method: s.method, path: s.pattern });
      }
    return out;
  }

  handle(req, res, done) {
    let i = 0;
    const stack = this.stack;
    const next = (err) => {
      while (i < stack.length) {
        const s = stack[i++];
        if (
          s.method &&
          s.method !== "*" &&
          s.method !== req.method &&
          !(req.method === "HEAD" && s.method === "GET")
        )
          continue;
        const m = s.re.exec(req.path);
        if (!m) continue;
        if (err ? !s.error : s.error) continue;
        if (s.route) {
          req.params = Object.create(null);
          s.keys.forEach((k, n) => {
            req.params[k] = m[n + 1];
          });
          req.route = s.pattern;
        } else req.params ||= Object.create(null);
        return call(s.fn, err, req, res, next);
      }
      done(err);
    };
    next();
  }
}
for (const m of METHODS)
  Router.prototype[m] = function (pattern, ...h) {
    return this.route(m.toUpperCase(), pattern, ...h);
  };

class RouteGroup {
  constructor(router, prefix, mws) {
    this.router = router;
    this.prefix = prefix;
    this.mws = mws;
  }
  route(method, pattern, ...h) {
    this.router.route(
      method,
      join(this.prefix, pattern),
      ...this.mws,
      ...h.flat(),
    );
    return this;
  }
  group(prefix, mw, cb) {
    cb(
      new RouteGroup(this.router, join(this.prefix, prefix), [
        ...this.mws,
        ...[].concat(mw || []),
      ]),
    );
    return this;
  }
}
for (const m of METHODS)
  RouteGroup.prototype[m] = function (pattern, ...h) {
    return this.route(m.toUpperCase(), pattern, ...h);
  };
