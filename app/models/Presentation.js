import { Model } from "../../core/model.js";
import { parseDeck } from "../../core/markdown.js";
import { config } from "../../config/config.js";

const cache = new Map(); // parsed decks keyed by id:updated_at

export class Presentation extends Model {
  static table = "presentations";
  static fillable = [
    "slug",
    "title",
    "markdown",
    "theme",
    "is_public",
    "created_by",
  ];
  static THEMES = ["light", "dark", "contrast"];

  static findBySlug(slug) {
    return this.db.get("SELECT * FROM presentations WHERE slug = ?", [
      String(slug),
    ]);
  }
  static deck(row) {
    const key = `${row.id}:${row.updated_at}`;
    let d = cache.get(key);
    if (!d) {
      d = parseDeck(row.markdown, config.presentations);
      if (cache.size > 100) cache.clear();
      cache.set(key, d);
    }
    return d;
  }
  static slugify(t) {
    return (
      String(t)
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "deck"
    );
  }
}
