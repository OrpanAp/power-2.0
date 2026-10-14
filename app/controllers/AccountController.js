import { Validator } from "../../core/validator.js";
import { Logger } from "../../core/logger.js";
import { encrypt, decrypt } from "../../core/crypto.js";
import { generateSecret, verifyTotp, otpauthUri } from "../../core/totp.js";
import { checkPassword } from "../../core/passwordPolicy.js";
import { User } from "../models/User.js";
import { auth } from "../auth.js";

/** Self-service security: password change, TOTP two-factor, session revocation. */
export class AccountController {
  static async security(req, res) {
    const setup = req.session.get("totp_setup");
    let backupLeft = 0;
    try {
      backupLeft = JSON.parse(req.user.backup_codes || "[]").length;
    } catch {
      /* none */
    }
    res.render("account/security", {
      title: "Account security",
      totpEnabled: !!req.user.totp_enabled,
      backupLeft,
      setupSecret: setup || "",
      setupUri: setup
        ? otpauthUri({
            secret: setup,
            account: req.user.email,
            issuer: req.app.config.name,
          })
        : "",
    });
  }

  static async changePassword(req, res) {
    const v = await Validator.make(req.body, {
      current_password: "required|string|max:128",
      new_password: [
        "required",
        "string",
        (val) =>
          checkPassword(val, { email: req.user.email, name: req.user.name }) ??
          true,
        (val, d) =>
          val !== d.current_password || "The new password must be different.",
      ],
      new_password_confirmation: "required|same:new_password",
    });
    if (v.fails()) return res.invalid(v.errors, {}, "/account/security");
    if (
      !(await auth.verify(req.body.current_password, req.user.password_hash))
    ) {
      Logger.warn(
        "Password change with wrong current password",
        { ip: req.ip },
        req.user.id,
      );
      return res.invalid(
        { current_password: ["Current password is incorrect."] },
        {},
        "/account/security",
      );
    }
    await User.update(req.user.id, {
      password_hash: await auth.hash(req.body.new_password),
      password_changed_at: new Date().toISOString(),
    });
    await req.session.store.revokeUser(req.user.id, null); // every device signed out, including this session's old id
    req.session.regenerate(); // …then this one continues under a fresh id + CSRF token
    Logger.info(
      "Password changed; all other sessions revoked",
      { ip: req.ip },
      req.user.id,
    );
    req.session.flash(
      "success",
      "Password updated. Other devices have been signed out.",
    );
    res.redirect("/account/security");
  }

  static startTotp(req, res) {
    if (req.user.totp_enabled) return res.redirect("/account/security");
    req.session.set("totp_setup", generateSecret());
    res.redirect("/account/security");
  }

  static async enableTotp(req, res) {
    const secret = req.session.get("totp_setup");
    if (!secret) return res.redirect("/account/security");
    const step = verifyTotp(
      secret,
      String(req.body.code || "").replace(/\s/g, ""),
    );
    if (step === null)
      return res.invalid(
        {
          code: [
            "That code is not valid. Check your authenticator app and try again.",
          ],
        },
        {},
        "/account/security",
      );
    const { plain, hashes } = User.newBackupCodes();
    await User.update(req.user.id, {
      totp_secret: encrypt(secret),
      totp_enabled: 1,
      totp_last_step: step,
      backup_codes: JSON.stringify(hashes),
    });
    req.session.forget("totp_setup");
    req.session.regenerate();
    Logger.info(
      "Two-factor authentication enabled",
      { ip: req.ip },
      req.user.id,
    );
    // Backup codes are rendered once, never flashed/stored in plain text.
    res.render("account/backup-codes", {
      title: "Save your backup codes",
      codes: plain,
    });
  }

  static async disableTotp(req, res) {
    if (!(await auth.verify(req.body.password || "", req.user.password_hash)))
      return res.invalid(
        { disable_password: ["Password is incorrect."] },
        {},
        "/account/security",
      );
    const secret = decrypt(req.user.totp_secret);
    const code = String(req.body.code || "").trim();
    const step =
      secret && verifyTotp(secret, code, Number(req.user.totp_last_step || 0));
    if (step === null || step === false) {
      if (!(await User.consumeBackupCode(req.user, code)))
        return res.invalid(
          { disable_code: ["Invalid authentication code."] },
          {},
          "/account/security",
        );
    }
    await User.update(req.user.id, {
      totp_secret: null,
      totp_enabled: 0,
      totp_last_step: null,
      backup_codes: null,
    });
    Logger.warn(
      "Two-factor authentication disabled",
      { ip: req.ip },
      req.user.id,
    );
    req.session.flash("success", "Two-factor authentication disabled.");
    res.redirect("/account/security");
  }

  static async signOutEverywhere(req, res) {
    await req.session.store.revokeUser(req.user.id, req.session.id);
    Logger.info("Signed out of all other sessions", {}, req.user.id);
    req.session.flash("success", "All other sessions have been revoked.");
    res.redirect("/account/security");
  }
}
