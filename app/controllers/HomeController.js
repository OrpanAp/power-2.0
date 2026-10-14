import { db } from "../../core/database.js";

export class HomeController {
  static index(req, res) {
    res.render("home", { title: "Welcome" });
  }

  static async dashboard(req, res) {
    const sessions = Number(
      (
        await db.get(
          "SELECT COUNT(*) AS c FROM sessions WHERE user_id = ? AND expires_at > ?",
          [req.user.id, Date.now()],
        )
      ).c,
    );
    res.render("dashboard", { title: "Dashboard", sessions });
  }

  static async health(req, res) {
    const ok = await db.ping();
    res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "degraded" }); // intentionally minimal: no uptime/version leak
  }
}
