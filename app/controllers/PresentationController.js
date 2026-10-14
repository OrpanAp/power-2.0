import { Validator } from "../../core/validator.js";
import { Logger } from "../../core/logger.js";
import { HttpError } from "../../core/errors.js";
import { parseDeck } from "../../core/markdown.js";
import { REACTIONS } from "../../core/live.js";
import { config } from "../../config/config.js";
import { Presentation } from "../models/Presentation.js";
import { auth } from "../auth.js";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const pub = (s) => ({ html: s.html, classes: s.classes }); // audience never receives notes
const load = async (req) => {
  const d = await Presentation.findBySlug(req.params.slug);
  if (!d) throw new HttpError(404, "Presentation not found");
  return d;
};
/** Public decks are open; others need a signed-in user. Returns true when the request may proceed. */
const canView = (d, req) => !!d.is_public || !!req.user;
const deny = (req) =>
  new HttpError(req.user ? 403 : 401, "Sign in to view this presentation");

export class PresentationController {
  /* ---------- Audience ---------- */
  static async index(req, res) {
    const rows = await Presentation.all(
      { is_public: 1 },
      { orderBy: "updated_at", order: "DESC", limit: 50 },
    );
    res.render("presentations/index", {
      title: "Presentations",
      decks: rows.map((d) => ({ ...d, live: req.app.hub.statusOf(d.slug) })),
    });
  }
  static async live(req, res, next) {
    const d = await load(req);
    if (!canView(d, req)) return auth.requireAuth(req, res, next);
    const deck = Presentation.deck(d);
    res.render("presentations/live", {
      title: d.title,
      deck: d,
      slides: deck.slides.map(pub),
      state: JSON.stringify(req.app.hub.snapshot(req.app.hub.room(d.slug))),
    });
    req.app.hub._gc(req.app.hub.room(d.slug));
  }
  static async liveSlides(req, res) {
    const d = await load(req);
    if (!canView(d, req)) throw deny(req);
    res.json({
      title: d.title,
      theme: d.theme,
      slides: Presentation.deck(d).slides.map(pub),
    });
  }
  static async liveEvents(req, res) {
    const d = await load(req);
    if (!canView(d, req)) throw deny(req);
    req.app.hub.join(req, res, d.slug, {
      total: Presentation.deck(d).slides.length,
    });
  }
  static async react(req, res) {
    const d = await load(req);
    if (!canView(d, req)) throw deny(req);
    req.app.hub.react(d.slug, String(req.body.kind || ""));
    res.status(204).end();
  }

  /* ---------- Presenter (admin) ---------- */
  static async presenter(req, res) {
    const d = await load(req);
    const deck = Presentation.deck(d);
    res.render("presentations/present", {
      title: `Presenting: ${d.title}`,
      deck: d,
      slides: deck.slides,
      state: JSON.stringify(req.app.hub.snapshot(req.app.hub.room(d.slug))),
      reactions: REACTIONS,
    });
  }
  static async presenterEvents(req, res) {
    const d = await load(req);
    req.app.hub.join(req, res, d.slug, {
      presenter: true,
      total: Presentation.deck(d).slides.length,
    });
  }
  static async control(req, res) {
    const d = await load(req);
    const total = Presentation.deck(d).slides.length;
    const index =
      typeof req.body.index === "number"
        ? req.body.index
        : /^-?\d+$/.test(String(req.body.index ?? ""))
          ? Number(req.body.index)
          : undefined;
    const snap = req.app.hub.control(
      d.slug,
      { action: String(req.body.action || ""), index },
      total,
    );
    if (["start", "end", "reset"].includes(req.body.action))
      Logger.info(
        `Presentation ${req.body.action}`,
        { slug: d.slug, viewers: snap.viewers },
        req.user.id,
      );
    res.json(snap);
  }

  /* ---------- Admin CRUD ---------- */
  static async adminIndex(req, res) {
    const rows = await Presentation.all(
      {},
      { orderBy: "updated_at", order: "DESC", limit: 200 },
    );
    res.render("admin/presentations/index", {
      title: "Presentations",
      section: "presentations",
      decks: rows.map((d) => ({ ...d, live: req.app.hub.statusOf(d.slug) })),
    });
  }
  static adminNew(req, res) {
    res.render("admin/presentations/form", {
      title: "New presentation",
      section: "presentations",
      target: null,
      action: "/admin/presentations",
      themes: Presentation.THEMES,
      sample:
        "# My talk\n\nSubtitle here\n\nNotes: only the presenter sees this\n\n---\n\n## First point\n\n- One\n- Two\n- Three\n",
    });
  }
  static async _validate(req, ignoreId) {
    const slug = (
      req.body.slug || Presentation.slugify(req.body.title || "")
    ).toLowerCase();
    const body = { ...req.body, slug };
    const v = await Validator.make(body, {
      title: "required|string|min:1|max:200",
      slug: [
        "required",
        "string",
        "max:80",
        (s) =>
          SLUG.test(s) ||
          "The slug may only contain lowercase letters, numbers and dashes.",
        ignoreId
          ? `unique:presentations,slug,${ignoreId}`
          : "unique:presentations,slug",
      ],
      theme: `required|in:${Presentation.THEMES.join(",")}`,
      markdown: [
        "required",
        "string",
        (m) => {
          try {
            parseDeck(m, config.presentations);
            return true;
          } catch (e) {
            return e.message;
          }
        },
      ],
    });
    return { v, body };
  }
  static async adminCreate(req, res) {
    const { v, body } = await PresentationController._validate(req);
    if (v.fails())
      return res.invalid(v.errors, body, "/admin/presentations/new");
    const d = v.validated();
    const row = await Presentation.create({
      slug: d.slug,
      title: d.title,
      markdown: d.markdown,
      theme: d.theme,
      is_public: req.body.is_public === "1" ? 1 : 0,
      created_by: req.user.id,
    });
    Logger.info("Presentation created", { slug: row.slug }, req.user.id);
    req.session.flash("success", "Presentation saved.");
    res.redirect(`/admin/presentations/${row.id}/edit`);
  }
  static async _target(req) {
    const d = /^\d+$/.test(req.params.id)
      ? await Presentation.find(Number(req.params.id))
      : null;
    if (!d) throw new HttpError(404, "Presentation not found");
    return d;
  }
  static async adminEdit(req, res) {
    const d = await PresentationController._target(req);
    res.render("admin/presentations/form", {
      title: `Edit: ${d.title}`,
      section: "presentations",
      target: d,
      action: `/admin/presentations/${d.id}`,
      themes: Presentation.THEMES,
      live: req.app.hub.statusOf(d.slug),
    });
  }
  static async adminUpdate(req, res) {
    const d = await PresentationController._target(req);
    const { v, body } = await PresentationController._validate(req, d.id);
    if (v.fails())
      return res.invalid(v.errors, body, `/admin/presentations/${d.id}/edit`);
    const x = v.validated();
    const row = await Presentation.update(d.id, {
      slug: x.slug,
      title: x.title,
      markdown: x.markdown,
      theme: x.theme,
      is_public: req.body.is_public === "1" ? 1 : 0,
    });
    if (row.slug !== d.slug) req.app.hub.close(d.slug);
    else
      req.app.hub.contentChanged(
        row.slug,
        Presentation.deck(row).slides.length,
      ); // live audience refreshes instantly
    Logger.info("Presentation updated", { slug: row.slug }, req.user.id);
    req.session.flash("success", "Saved. Connected viewers were updated live.");
    res.redirect(`/admin/presentations/${d.id}/edit`);
  }
  static async adminDestroy(req, res) {
    const d = await PresentationController._target(req);
    await Presentation.delete(d.id);
    req.app.hub.close(d.slug);
    Logger.warn("Presentation deleted", { slug: d.slug }, req.user.id);
    req.session.flash("success", "Presentation deleted.");
    res.redirect("/admin/presentations");
  }
  /** Live editor preview: parse the posted Markdown (never stored) and return sanitised slide HTML. */
  static preview(req, res) {
    try {
      const deck = parseDeck(
        String(req.body.markdown || ""),
        config.presentations,
      );
      res.json({
        slides: deck.slides.map((s) => ({
          html: s.html,
          notes: s.notes,
          classes: s.classes,
        })),
      }); // only sanitised HTML leaves this endpoint
    } catch (e) {
      res.status(e.status || 400).json({ error: e.message });
    }
  }
}
