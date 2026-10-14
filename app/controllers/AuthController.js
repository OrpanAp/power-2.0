import { Validator } from "../../core/validator.js";
import { Logger } from "../../core/logger.js";
import { config } from "../../config/config.js";
import { decrypt } from "../../core/crypto.js";
import { verifyTotp } from "../../core/totp.js";
import { passwordRule } from "../../core/passwordPolicy.js";
import { User } from "../models/User.js";
import { auth } from "../auth.js";

const GENERIC = "These credentials do not match our records.";
const home = (u) => (u.role === "admin" ? "/admin" : "/dashboard");
const PENDING_MS = 5 * 60 * 1000;

async function complete(req, res, user) {
  const intended = req.session.get("intended");
  auth.login(req, user); // new session id + CSRF token (anti-fixation)
  await User.touchLogin(user.id);
  Logger.info(
    "User signed in",
    { email: user.email, ip: req.ip, mfa: !!user.totp_enabled },
    user.id,
  );
  const ok =
    intended && (user.role === "admin" || !intended.startsWith("/admin"));
  res.redirect(ok ? intended : home(user));
}

export class AuthController {
  static showLogin(req, res) {
    res.render("auth/login", { title: "Sign in" });
  }

  static async login(req, res) {
    const v = await Validator.make(req.body, {
      email: "required|email",
      password: "required|string|max:128",
    });
    if (v.fails())
      return res.invalid(v.errors, { email: req.body.email }, "/login");

    const { user } = await auth.attempt(
      req.body.email,
      req.body.password,
      req.ip,
    );
    if (!user)
      return res.invalid(
        { email: [GENERIC] },
        { email: req.body.email },
        "/login",
      ); // same message for every failure reason

    if (user.totp_enabled) {
      req.session.regenerate();
      req.session.set("pending_2fa", { id: user.id, at: Date.now() });
      return res.redirect("/login/2fa");
    }
    await complete(req, res, user);
  }

  static showTwoFactor(req, res) {
    const p = req.session.get("pending_2fa");
    if (!p || Date.now() - p.at > PENDING_MS) {
      req.session.forget("pending_2fa");
      return res.redirect("/login");
    }
    res.render("auth/two-factor", { title: "Two-factor authentication" });
  }

  static async verifyTwoFactor(req, res) {
    const p = req.session.get("pending_2fa");
    if (!p || Date.now() - p.at > PENDING_MS) {
      req.session.forget("pending_2fa");
      return res.redirect("/login");
    }
    const user = await User.find(p.id);
    if (!user || !user.is_active || auth.isLocked(user)) {
      req.session.forget("pending_2fa");
      return res.invalid({ email: [GENERIC] }, {}, "/login");
    }

    const raw = String(req.body.code || "").trim();
    let ok = false;
    const secret = decrypt(user.totp_secret);
    if (/^\d{6}$/.test(raw) && secret) {
      const step = verifyTotp(secret, raw, Number(user.totp_last_step || 0));
      if (step !== null) {
        ok = true;
        await User.update(user.id, { totp_last_step: step });
      }
    } else if (/^[0-9a-f]{5}-[0-9a-f]{5}$/i.test(raw)) {
      ok = await User.consumeBackupCode(user, raw);
      if (ok)
        Logger.warn("Backup code used to sign in", { ip: req.ip }, user.id);
    }
    if (!ok) {
      const locked = await User.recordFailure(user, config.lockout);
      Logger.warn("Failed two-factor attempt", { ip: req.ip, locked }, user.id);
      return res.invalid(
        { code: ["Invalid authentication code."] },
        {},
        "/login/2fa",
      );
    }
    req.session.forget("pending_2fa");
    await complete(req, res, user);
  }

  static showRegister(req, res) {
    if (!config.allowRegistration) return res.redirect("/login");
    res.render("auth/register", { title: "Create account" });
  }

  static async register(req, res) {
    if (!config.allowRegistration) return res.redirect("/login");
    const v = await Validator.make(req.body, {
      name: "required|string|min:2|max:80",
      email: "required|email|max:190|unique:users,email",
      password: ["required", "string", passwordRule],
      password_confirmation: "required|same:password",
    });
    if (v.fails())
      return res.invalid(
        v.errors,
        { name: req.body.name, email: req.body.email },
        "/register",
      );

    const d = v.validated();
    // Role is NEVER taken from user input: self-registration always yields a plain user.
    const user = await User.create({
      name: d.name,
      email: d.email.toLowerCase(),
      password_hash: await auth.hash(d.password),
      role: "user",
      is_active: 1,
      password_changed_at: new Date().toISOString(),
    });
    auth.login(req, user);
    await User.touchLogin(user.id);
    Logger.info("User registered", { email: user.email, ip: req.ip }, user.id);
    req.session.flash("success", `Welcome, ${user.name}!`);
    res.redirect("/dashboard");
  }

  /** GET /logout — logging out changes state, so it stays POST+CSRF; this page just offers the button. */
  static logoutPage(req, res) {
    if (!req.user) return res.redirect("/login");
    res.render("auth/logout", { title: "Sign out" });
  }

  static logout(req, res) {
    const id = req.user?.id;
    auth.logout(req);
    req.session.flash("success", "You have been signed out.");
    Logger.info("User signed out", {}, id);
    res.redirect("/login");
  }
}
