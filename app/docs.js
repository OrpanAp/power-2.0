import fs from "node:fs";
import path from "node:path";
import { renderDoc } from "../core/markdown.js";
import { escapeHtml } from "../core/security.js";
import { config } from "../config/config.js";

/** Documentation manifest: [slug, title]. Files live in docs/<slug>.md. Only slugs listed here can be served. */
export const GROUPS = [
  {
    group: "Getting started",
    pages: [
      ["introduction", "Introduction"],
      ["quick-start", "Quick start"],
      ["project-structure", "Project structure"],
      ["configuration", "Configuration & environment"],
    ],
  },
  {
    group: "The basics",
    pages: [
      ["routing", "Routing & middleware"],
      ["templates", "Templates & views"],
      ["database", "Databases & models"],
      ["validation", "Validation & sanitization"],
    ],
  },
  {
    group: "Security",
    pages: [
      ["authentication", "Authentication & roles"],
      ["security", "Security guide"],
    ],
  },
  {
    group: "Features",
    pages: [
      ["live-reload", "Live reload"],
      ["presentations", "Live presentations"],
      ["admin", "Admin dashboard"],
    ],
  },
  {
    group: "Reference",
    pages: [
      ["cli", "CLI reference"],
      ["api-reference", "Core API reference"],
      ["deployment", "Deployment"],
      ["testing", "Testing"],
      ["faq", "FAQ & troubleshooting"],
    ],
  },
];
export const ORDER = GROUPS.flatMap((g) =>
  g.pages.map(([slug, title]) => ({ slug, title, group: g.group })),
);
const BY_SLUG = new Map(ORDER.map((p) => [p.slug, p]));
const DIR = path.join(config.root, "docs");
const cache = new Map(); // slug -> { mtime, doc }

export function loadDoc(slug) {
  const meta = BY_SLUG.get(slug);
  if (!meta) return null;
  const file = path.join(DIR, `${slug}.md`);
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  const hit = cache.get(slug);
  if (hit && hit.mtime === st.mtimeMs) return hit.doc;
  const doc = { ...meta, ...renderDoc(fs.readFileSync(file, "utf8")) };
  cache.set(slug, { mtime: st.mtimeMs, doc });
  return doc;
}
export function neighbors(slug) {
  const i = ORDER.findIndex((p) => p.slug === slug);
  return {
    prev: i > 0 ? ORDER[i - 1] : null,
    next: i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1] : null,
  };
}

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Plain-text search over all docs. Returns ranked results with an HTML-safe snippet (<mark> around matches). */
export function searchDocs(query) {
  const q = String(query || "")
    .trim()
    .slice(0, 80);
  if (q.length < 2) return { q, results: [] };
  const needle = q.toLowerCase(),
    results = [];
  for (const meta of ORDER) {
    const doc = loadDoc(meta.slug);
    if (!doc) continue;
    const text = doc.text,
      lower = text.toLowerCase(),
      at = lower.indexOf(needle);
    const inTitle = doc.title.toLowerCase().includes(needle),
      inHead = doc.toc.some((h) => h.text.toLowerCase().includes(needle));
    if (at < 0 && !inTitle && !inHead) continue;
    const count = at < 0 ? 0 : lower.split(needle).length - 1;
    const from = Math.max(0, (at < 0 ? 0 : at) - 70),
      snip = text.slice(from, from + 220);
    const html = escapeHtml(snip).replace(
      new RegExp(reEsc(escapeHtml(q)), "gi"),
      (m) => `<mark>${m}</mark>`,
    );
    results.push({
      slug: meta.slug,
      title: doc.title,
      group: meta.group,
      snippet:
        (from > 0 ? "… " : "") + html + (from + 220 < text.length ? " …" : ""),
      score: (inTitle ? 100 : 0) + (inHead ? 40 : 0) + Math.min(count, 20),
    });
  }
  return { q, results: results.sort((a, b) => b.score - a.score).slice(0, 20) };
}
