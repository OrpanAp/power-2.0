import { db } from "../../core/database.js";
import { manager } from "../../core/db/index.js";
import { Validator } from "../../core/validator.js";
import { Logger } from "../../core/logger.js";
import { HttpError } from "../../core/errors.js";
import { collectHealth } from "../../core/health.js";
import { buildPager } from "../../core/helpers.js";
import { passwordRule } from "../../core/passwordPolicy.js";
import { User } from "../models/User.js";
import { SystemLog } from "../models/SystemLog.js";
import { auth } from "../auth.js";

const PROTECTED_TABLES = new Set(["migrations", "users"]); // rows can't be deleted via the generic table browser
const SECRET_COL = /password|secret|token|backup|totp/i;
const maskCol = (table, col) =>
  SECRET_COL.test(col) ||
  (table === "sessions" && (col === "id" || col === "data"));
const cell = (v) =>
  v === null
    ? "NULL"
    : String(v).length > 120
      ? String(v).slice(0, 119) + "…"
      : String(v);
const lastAdminGuard = async (target, next) =>
  target.role === "admin" &&
  (next.role !== "admin" || !next.is_active) &&
  (await User.count({ role: "admin", is_active: 1 })) <= 1
    ? "You cannot demote or deactivate the last active administrator."
    : null;

function conn(req) {
  const name = String(req.query.conn || "default");
  if (!manager.names().includes(name))
    throw new HttpError(404, "Unknown database connection");
  return { name, c: manager.connection(name) };
}

export class AdminController {
  /* ---------- Dashboard & health ---------- */
  static async dashboard(req, res) {
    const since = new Date(Date.now() - 864e5).toISOString();
    const n = async (sql, p = []) => Number((await db.get(sql, p)).c);
    const stats = {
      users: await User.count(),
      admins: await User.count({ role: "admin" }),
      active: await User.count({ is_active: 1 }),
      locked: await n(
        "SELECT COUNT(*) AS c FROM users WHERE locked_until > ?",
        [Date.now()],
      ),
      mfa: await User.count({ totp_enabled: 1 }),
      sessions: await n(
        "SELECT COUNT(*) AS c FROM sessions WHERE expires_at > ?",
        [Date.now()],
      ),
      logs: await SystemLog.count(),
      errors24h: await n(
        "SELECT COUNT(*) AS c FROM system_logs WHERE level = 'error' AND created_at > ?",
        [since],
      ),
      warns24h: await n(
        "SELECT COUNT(*) AS c FROM system_logs WHERE level = 'warn' AND created_at > ?",
        [since],
      ),
    };
    res.render("admin/dashboard", {
      title: "Dashboard",
      section: "dashboard",
      stats,
      health: await collectHealth(req.app),
      recent: await SystemLog.all(
        {},
        { orderBy: "id", order: "DESC", limit: 8 },
      ),
    });
  }
  static async healthJson(req, res) {
    res.json(await collectHealth(req.app));
  }

  /* ---------- Users ---------- */
  static async usersIndex(req, res) {
    const result = await User.search(req.query.q, req.query.page);
    res.render("admin/users/index", {
      title: "Users",
      section: "users",
      users: result.data,
      pager: buildPager(result, req),
      q: req.query.q || "",
      now: Date.now(),
    });
  }
  static usersCreate(req, res) {
    res.render("admin/users/form", {
      title: "New user",
      section: "users",
      target: null,
      action: "/admin/users",
    });
  }

  static async usersStore(req, res) {
    const v = await Validator.make(req.body, {
      name: "required|string|min:2|max:80",
      email: "required|email|max:190|unique:users,email",
      role: "required|in:admin,user",
      password: ["required", "string", passwordRule],
    });
    if (v.fails())
      return res.invalid(
        v.errors,
        { name: req.body.name, email: req.body.email, role: req.body.role },
        "/admin/users/new",
      );
    const d = v.validated();
    const u = await User.create({
      name: d.name,
      email: d.email.toLowerCase(),
      role: d.role,
      is_active: req.body.is_active === "1" ? 1 : 0,
      password_hash: await auth.hash(d.password),
      password_changed_at: new Date().toISOString(),
    });
    Logger.info(
      "Admin created user",
      { email: u.email, role: u.role },
      req.user.id,
    );
    req.session.flash("success", `User ${u.email} created.`);
    res.redirect("/admin/users");
  }
  static async _target(req) {
    const u = /^\d+$/.test(req.params.id)
      ? await User.find(Number(req.params.id))
      : null;
    if (!u) throw new HttpError(404, "User not found");
    return u;
  }
  static async usersEdit(req, res) {
    const u = await AdminController._target(req);
    res.render("admin/users/form", {
      title: `Edit ${u.name}`,
      section: "users",
      target: u,
      action: `/admin/users/${u.id}`,
    });
  }
  static async usersUpdate(req, res) {
    const u = await AdminController._target(req);
    const v = await Validator.make(req.body, {
      name: "required|string|min:2|max:80",
      email: `required|email|max:190|unique:users,email,${u.id}`,
      role: "required|in:admin,user",
      password: ["nullable", "string", passwordRule],
    });
    if (v.fails())
      return res.invalid(
        v.errors,
        { name: req.body.name, email: req.body.email, role: req.body.role },
        `/admin/users/${u.id}/edit`,
      );
    const d = v.validated();
    const next = {
      role: d.role,
      is_active: req.body.is_active === "1" ? 1 : 0,
    };
    const blocked =
      (await lastAdminGuard(u, next)) ||
      (u.id === req.user.id && (!next.is_active || next.role !== "admin")
        ? "You cannot deactivate or demote your own account."
        : null);
    if (blocked)
      return res.invalid(
        { role: [blocked] },
        { name: req.body.name, email: req.body.email, role: req.body.role },
        `/admin/users/${u.id}/edit`,
      );
    const patch = { name: d.name, email: d.email.toLowerCase(), ...next };
    if (req.body.unlock === "1") {
      patch.failed_logins = 0;
      patch.locked_until = null;
    }
    if (d.password) {
      patch.password_hash = await auth.hash(d.password);
      patch.password_changed_at = new Date().toISOString();
    }
    await User.update(u.id, patch);
    // Privilege/credential changes invalidate existing sessions of that user.
    if (!next.is_active || d.password || next.role !== u.role)
      await req.session.store.revokeUser(
        u.id,
        u.id === req.user.id ? req.session.id : null,
      );
    Logger.info(
      "Admin updated user",
      { id: u.id, role: next.role, active: next.is_active },
      req.user.id,
    );
    req.session.flash("success", "User updated.");
    res.redirect("/admin/users");
  }
  static async usersDestroy(req, res) {
    const u = await AdminController._target(req);
    const blocked =
      u.id === req.user.id
        ? "You cannot delete your own account."
        : await lastAdminGuard(u, { role: "user", is_active: 0 });
    if (blocked) {
      req.session.flash("error", blocked);
      return res.redirect("/admin/users");
    }
    await User.delete(u.id);
    Logger.warn("Admin deleted user", { email: u.email }, req.user.id);
    req.session.flash("success", `User ${u.email} deleted.`);
    res.redirect("/admin/users");
  }

  /* ---------- Database tables (any configured connection) ---------- */
  static async tablesIndex(req, res) {
    const { name: connName, c } = conn(req);
    const tables = [];
    for (const name of await c.tables())
      tables.push({
        name,
        rows: Number((await c.get(`SELECT COUNT(*) AS c FROM ${c.q(name)}`)).c),
        cols: (await c.columns(name)).length,
      });
    res.render("admin/tables/index", {
      title: "Database",
      section: "tables",
      tables,
      conn: connName,
      conns: manager
        .names()
        .map((n) => ({ name: n, driver: manager.connection(n).dialect })),
      driver: c.dialect,
      target: c.info().target,
    });
  }
  static async tableShow(req, res) {
    const { name: connName, c } = conn(req),
      name = req.params.name;
    if (!(await c.tables()).includes(name))
      throw new HttpError(404, "Unknown table");
    const cols = await c.columns(name);
    const pk = cols.filter((x) => x.pk);
    const pkCol = pk.length === 1 ? pk[0].name : null;
    const per = 25,
      page = Math.max(1, parseInt(req.query.page) || 1);
    const sort =
      cols.find((x) => x.name === req.query.sort)?.name ||
      pkCol ||
      cols[0]?.name;
    const dir = req.query.dir === "asc" ? "ASC" : "DESC";
    const total = Number(
      (await c.get(`SELECT COUNT(*) AS c FROM ${c.q(name)}`)).c,
    );
    const rows = (
      await c.all(
        `SELECT * FROM ${c.q(name)} ORDER BY ${c.q(sort)} ${dir} LIMIT ? OFFSET ?`,
        [per, (page - 1) * per],
      )
    ).map((r) => ({
      rid: pkCol ? encodeURIComponent(String(r[pkCol])) : "",
      cells: cols.map((x) => ({
        v: maskCol(name, x.name) ? "••••••" : cell(r[x.name]),
      })),
    }));
    const result = { page, pages: Math.max(1, Math.ceil(total / per)), total };
    res.render("admin/tables/show", {
      title: `Table ${name}`,
      section: "tables",
      name,
      conn: connName,
      cols,
      rows,
      total,
      pager: buildPager(result, req),
      nextDir: dir === "ASC" ? "desc" : "asc",
      canDelete: !!pkCol && !PROTECTED_TABLES.has(name),
    });
  }
  static async tableRowDestroy(req, res) {
    const { name: connName, c } = conn(req),
      { name, rid } = req.params;
    if (!(await c.tables()).includes(name))
      throw new HttpError(404, "Unknown table");
    if (PROTECTED_TABLES.has(name))
      throw new HttpError(403, `Rows in "${name}" are read-only here.`);
    const pk = (await c.columns(name)).filter((x) => x.pk);
    if (pk.length !== 1 || !/^[\w.-]+$/.test(rid))
      throw new HttpError(400, "Row cannot be addressed");
    await c.run(`DELETE FROM ${c.q(name)} WHERE ${c.q(pk[0].name)} = ?`, [rid]);
    Logger.warn(
      "Admin deleted table row",
      { connection: connName, table: name, pk: rid },
      req.user.id,
    );
    req.session.flash("success", "Row deleted.");
    res.redirect(`/admin/tables/${name}?conn=${encodeURIComponent(connName)}`);
  }

  /* ---------- System logs ---------- */
  static async logs(req, res) {
    const level = ["debug", "info", "warn", "error"].includes(req.query.level)
      ? req.query.level
      : "";
    const result = await SystemLog.paginate(
      req.query.page,
      25,
      level ? { level } : {},
      { orderBy: "id", order: "DESC" },
    );
    res.render("admin/logs", {
      title: "System logs",
      section: "logs",
      logs: result.data,
      pager: buildPager(result, req),
      level,
    });
  }
  static async logsPurge(req, res) {
    const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
    const { changes } = await db.run(
      "DELETE FROM system_logs WHERE created_at < ?",
      [cutoff],
    );
    Logger.warn(
      "Logs older than 30 days purged",
      { removed: changes },
      req.user.id,
    );
    req.session.flash(
      "success",
      `Purged ${changes} log entries older than 30 days.`,
    );
    res.redirect("/admin/logs");
  }
}
