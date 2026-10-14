import { rateLimit } from "../../core/middleware.js";
import { config } from "../../config/config.js";
import { auth } from "../auth.js";
import { HomeController } from "../controllers/HomeController.js";
import { AuthController } from "../controllers/AuthController.js";
import { AccountController } from "../controllers/AccountController.js";

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.authRateLimit,
  message: "Too many attempts. Please wait a few minutes.",
});
const sensitiveLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15 });

export function webRoutes(app) {
  app.get("/health", HomeController.health);

  app.get("/login", auth.requireGuest, AuthController.showLogin);
  app.post("/login", auth.requireGuest, authLimiter, AuthController.login);
  app.get("/login/2fa", auth.requireGuest, AuthController.showTwoFactor);
  app.post(
    "/login/2fa",
    auth.requireGuest,
    authLimiter,
    AuthController.verifyTwoFactor,
  );
  app.get("/register", auth.requireGuest, AuthController.showRegister);
  app.post(
    "/register",
    auth.requireGuest,
    authLimiter,
    AuthController.register,
  );
  app.get("/logout", AuthController.logoutPage); // friendly: visiting /logout never 404s
  app.post("/logout", auth.requireAuth, AuthController.logout);

  app.get("/dashboard", auth.requireAuth, HomeController.dashboard);

  app.group("/account", [auth.requireAuth], (r) => {
    r.get("/security", AccountController.security);
    r.post("/password", sensitiveLimiter, AccountController.changePassword);
    r.post("/2fa/start", AccountController.startTotp);
    r.post("/2fa/enable", sensitiveLimiter, AccountController.enableTotp);
    r.post("/2fa/disable", sensitiveLimiter, AccountController.disableTotp);
    r.post("/sessions/revoke", AccountController.signOutEverywhere);
  });
}
