import { rateLimit } from "../../core/middleware.js";
import { SiteController as S } from "../controllers/SiteController.js";

const demoLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  perPath: false,
  message: "The demo is rate limited. Please slow down.",
});

export function siteRoutes(app) {
  app.get("/", S.home);

  app.get("/docs", S.docsHome);
  app.get("/docs/search", S.docsSearch);
  app.get("/docs/:slug", S.docsPage);

  app.get("/demo", S.demoIndex);
  app.get("/demo/security", S.demoSecurity);
  app.get("/demo/schema", S.demoSchema);
  app.get("/demo/markdown", S.demoMarkdown);
  app.get("/demo/live", S.demoLive);
  app.get("/demo/stream", S.stream);
  app.get("/demo/teapot", S.teapot);
  app.get(
    "/demo/routing/:id",
    S.trace("request-logger"),
    S.trace("parameter-check"),
    S.routing,
  );

  app.post("/demo/api/escape", demoLimiter, S.apiEscape);
  app.post("/demo/api/validate", demoLimiter, S.apiValidate);
  app.post("/demo/api/password", demoLimiter, S.apiPassword);
  app.post("/demo/api/markdown", demoLimiter, S.apiMarkdown);
}
