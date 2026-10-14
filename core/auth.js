import { hashPassword, verifyPassword, needsRehash } from "./security.js";
import { HttpError } from "./errors.js";
import { wantsJson } from "./http.js";
import { Logger } from "./logger.js";
import { config } from "../config/config.js";

/** Auth helpers bound to a user model. Roles: 'admin' | 'user'. Includes account lockout, rehash-on-login and optional admin 2FA enforcement. */
export function createAuth(User) {
  const dummy = hashPassword("power-timing-equalizer"); // equalises timing when the email doesn't exist
  const isLocked = (u) => Number(u.locked_until || 0) > Date.now();

  return {
    isLocked,
    async loadUser(req, res, next) {
      req.user = null;
      if (req.session.userId) {
        const u = await User.find(req.session.userId);
        if (u && u.is_active) req.user = u;
        else req.session.destroy();
      }
      next();
    },
    /** Returns { user } on success or { user: null, reason }. The reason is for logs only — never show it to the visitor. */
    async attempt(email, password, ip) {
      const u = await User.findByEmail(email);
      if (!u) {
        await verifyPassword(password, await dummy);
        return { user: null, reason: "unknown_user" };
      }
      const ok = await verifyPassword(password, u.password_hash); // always verified, so locked/unknown/known cost the same
      if (isLocked(u)) {
        Logger.warn(
          "Login attempt on locked account",
          { email: u.email, ip },
          u.id,
        );
        return { user: null, reason: "locked" };
      }
      if (!ok || !u.is_active) {
        const locked = await User.recordFailure(u, config.lockout);
        Logger.warn(
          locked
            ? "Account locked after repeated failures"
            : "Failed login attempt",
          { email: u.email, ip, inactive: !u.is_active },
          u.id,
        );
        return { user: null, reason: ok ? "inactive" : "bad_password" };
      }
      if (needsRehash(u.password_hash))
        await User.update(u.id, {
          password_hash: await hashPassword(password),
        });
      return { user: u, reason: null };
    },
    login(req, user) {
      req.session.login(user.id);
    },
    logout(req) {
      req.session.destroy();
    },
    hash: hashPassword,
    verify: verifyPassword,

    requireGuest(req, res, next) {
      return req.user ? res.redirect("/dashboard") : next();
    },
    requireAuth(req, res, next) {
      if (req.user) return next();
      if (wantsJson(req))
        return next(new HttpError(401, "Authentication required"));
      if (req.method === "GET" && /^\/(?![/\\])/.test(req.originalUrl))
        req.session.set("intended", req.originalUrl);
      req.session.flash("error", "Please sign in to continue.");
      return res.redirect("/login");
    },
    requireRole(...roles) {
      return (req, res, next) => {
        if (!req.user) return this.requireAuth(req, res, next);
        if (!roles.includes(req.user.role))
          return next(
            new HttpError(
              403,
              "You do not have permission to access this area.",
            ),
          );
        next();
      };
    },
    /** With REQUIRE_ADMIN_2FA=1, admins must enrol an authenticator app before using the admin area. */
    require2fa(req, res, next) {
      if (
        config.require2faAdmin &&
        req.user?.role === "admin" &&
        !req.user.totp_enabled
      ) {
        req.session.flash(
          "error",
          "Administrators must enable two-factor authentication before continuing.",
        );
        return res.redirect("/account/security");
      }
      next();
    },
  };
}
