import { rateLimit } from "../../core/middleware.js";
import { auth } from "../auth.js";
import { PresentationController as P } from "../controllers/PresentationController.js";

const reactLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: "Slow down — too many reactions.",
});
const controlLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  perPath: false,
});
const adminOnly = [auth.requireRole("admin"), auth.require2fa];

export function presentationRoutes(app) {
  // Audience (public decks open to everyone, others need an account)
  app.get("/presentations", P.index);
  app.get("/live/:slug", P.live);
  app.get("/live/:slug/slides", P.liveSlides);
  app.get("/live/:slug/events", P.liveEvents);
  app.post("/live/:slug/react", reactLimit, P.react); // CSRF-token-exempt (see app.js), Origin-checked + rate-limited

  // Presenter
  app.group("/present", adminOnly, (r) => {
    r.get("/:slug", P.presenter);
    r.get("/:slug/events", P.presenterEvents);
    r.post("/:slug/control", controlLimit, P.control);
  });

  // Deck management
  app.group("/admin/presentations", adminOnly, (r) => {
    r.get("/", P.adminIndex);
    r.get("/new", P.adminNew);
    r.post("/", P.adminCreate);
    r.post("/preview", controlLimit, P.preview);
    r.get("/:id/edit", P.adminEdit);
    r.put("/:id", P.adminUpdate);
    r.delete("/:id", P.adminDestroy);
  });
}
