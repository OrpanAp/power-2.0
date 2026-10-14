import { Model } from "../../core/model.js";
import { db } from "../../core/database.js";
import { sha256hex } from "../../core/security.js";
import { randomBytes } from "node:crypto";

export class User extends Model {
  static table = "users";
  static fillable = [
    "name",
    "email",
    "password_hash",
    "role",
    "is_active",
    "last_login_at",
    "failed_logins",
    "locked_until",
    "password_changed_at",
    "totp_secret",
    "totp_enabled",
    "totp_last_step",
    "backup_codes",
  ];
  static hidden = ["password_hash", "totp_secret", "backup_codes"];
  static ROLES = ["admin", "user"];

  static findByEmail(email) {
    return db.get("SELECT * FROM users WHERE email = ?", [
      String(email).trim().toLowerCase(),
    ]);
  }
  static touchLogin(id) {
    return User.update(id, {
      last_login_at: new Date().toISOString(),
      failed_logins: 0,
      locked_until: null,
    });
  }

  /** Counts a failed login; locks the account with exponential back-off once the threshold is reached. Returns true if now locked. */
  static async recordFailure(u, { after, baseMs, maxMs }) {
    const n = Number(u.failed_logins || 0) + 1;
    const lock =
      n >= after
        ? Date.now() + Math.min(baseMs * 2 ** (n - after), maxMs)
        : null;
    await db.run(
      "UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?",
      [n, lock, u.id],
    );
    return !!lock;
  }

  static async search(q, page = 1, perPage = 15) {
    page = Math.max(1, parseInt(page) || 1);
    const like = `%${String(q || "")
      .toLowerCase()
      .replace(/[!%_]/g, "!$&")}%`; // '!' is the LIKE escape char (portable across dialects)
    const where =
      "WHERE LOWER(name) LIKE ? ESCAPE '!' OR LOWER(email) LIKE ? ESCAPE '!'";
    const total = Number(
      (await db.get(`SELECT COUNT(*) AS c FROM users ${where}`, [like, like]))
        .c,
    );
    const data = await db.all(
      `SELECT * FROM users ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [like, like, perPage, (page - 1) * perPage],
    );
    return {
      data,
      total,
      page,
      perPage,
      pages: Math.max(1, Math.ceil(total / perPage)),
    };
  }

  /** 8 single-use recovery codes; only SHA-256 hashes are stored. Returns { plain, hashes }. */
  static newBackupCodes() {
    const plain = Array.from({ length: 8 }, () => {
      const h = randomBytes(5).toString("hex");
      return `${h.slice(0, 5)}-${h.slice(5)}`;
    });
    return { plain, hashes: plain.map((c) => sha256hex(c)) };
  }
  static async consumeBackupCode(u, input) {
    let list = [];
    try {
      list = JSON.parse(u.backup_codes || "[]");
    } catch {
      /* none */
    }
    const h = sha256hex(String(input).trim().toLowerCase());
    if (!list.includes(h)) return false;
    await User.update(u.id, {
      backup_codes: JSON.stringify(list.filter((x) => x !== h)),
    });
    return true;
  }
}
