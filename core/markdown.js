import { escapeHtml as esc } from "./security.js";
import { HttpError } from "./errors.js";
import { highlight } from "./highlight.js";

/* Safe Markdown → HTML. Everything is escaped first; only URLs from an allow-list become links/images.
 * Supported: # headings, paragraphs, **bold**, *italic*, ~~strike~~, `code`, ```fenced```, > quotes,
 * - / 1. lists (one nesting level), | tables |, [links](url), ![images](/path or data:image) */

const URL_LINK =
  /^(?:https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+|\/(?![/\\])[^\s<>"']*|#[\w-]+)$/i;
const URL_IMG =
  /^(?:\/(?![/\\])[\w\-./%]+|data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+)$/; // same-origin or data: only (CSP img-src)

function inline(raw) {
  const stash = [];
  const keep = (h) => `\u0000${stash.push(h) - 1}\u0000`;
  let s = String(raw).replace(/\u0000/g, ""); // placeholders can't be forged
  s = s.replace(/`([^`\n]+)`/g, (_, c) => keep(`<code>${esc(c)}</code>`));
  s = s.replace(
    /!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"([^"\n]*)")?\)/g,
    (_, alt, url, title) => {
      const u = url;
      return URL_IMG.test(u)
        ? keep(
            `<img src="${esc(u)}" alt="${esc(alt)}"${title ? ` title="${esc(title)}"` : ""} loading="lazy">`,
          )
        : keep(esc(alt));
    },
  );
  s = s.replace(
    /\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"\n]*")?\)/g,
    (_, text, url) => {
      if (!URL_LINK.test(url)) return text;
      const ext = /^https?:/i.test(url);
      return (
        keep(
          `<a href="${esc(url)}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ""}>`,
        ) +
        text +
        keep("</a>")
      );
    },
  );
  s = esc(s);
  s = s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/\*(?!\s)(.+?)\*/g, "<em>$1</em>")
    .replace(/(^|[^\w])_(?!\s)(.+?)_(?=[^\w]|$)/g, "$1<em>$2</em>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[+i]);
}

const isFence = (l) => /^\s*```\s*([\w-]{0,20})\s*$/.exec(l);
const isHeading = (l) => /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(l);
const isUl = (l) => /^(\s*)[-*+]\s+(.*)$/.exec(l);
const isOl = (l) => /^(\s*)\d+[.)]\s+(.*)$/.exec(l);
const isTableSep = (l) =>
  /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l || "");
const cells = (l) =>
  l
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

/** ctx (optional): { ids: true → heading anchors + collected headings, highlight: true → syntax-highlight fenced code } */
export function renderMarkdown(src, depth = 0, ctx = null) {
  if (depth > 6) return `<p>${inline(src)}</p>`;
  const lines = String(src).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  const blockStart = (l) =>
    isFence(l) || isHeading(l) || isUl(l) || isOl(l) || /^\s*>/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    let m;
    if ((m = isFence(line))) {
      const code = [];
      i++;
      while (i < lines.length && !isFence(lines[i])) code.push(lines[i++]);
      i++;
      const body = ctx?.highlight
        ? highlight(code.join("\n"), m[1])
        : esc(code.join("\n"));
      out.push(
        `<pre${m[1] ? ` data-lang="${m[1]}"` : ""}><code${m[1] ? ` class="lang-${m[1]}"` : ""}>${body}</code></pre>`,
      );
      continue;
    }
    if ((m = isHeading(line))) {
      const lvl = m[1].length;
      if (ctx?.ids) {
        const plain = m[2]
          .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
          .replace(/[`*_~]/g, "")
          .trim();
        let id =
            plain
              .toLowerCase()
              .normalize("NFKD")
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "") || "section",
          k = 1;
        while (ctx.used.has(id)) id = `${id.replace(/-\d+$/, "")}-${++k}`;
        ctx.used.add(id);
        ctx.headings.push({ level: lvl, text: plain, id });
        out.push(
          `<h${lvl} id="${id}">${inline(m[2])}${lvl > 1 ? `<a class="anchor" href="#${id}" aria-label="Link to this section">#</a>` : ""}</h${lvl}>`,
        );
      } else out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i]))
        q.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(
        `<blockquote>${renderMarkdown(q.join("\n"), depth + 1, ctx)}</blockquote>`,
      );
      continue;
    }
    if (isUl(line) || isOl(line)) {
      const ordered = !!isOl(line),
        re = ordered ? isOl : isUl,
        items = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        (re(lines[i]) || /^\s{2,}\S/.test(lines[i]))
      ) {
        const mm = re(lines[i]);
        if (mm && mm[1].length < 2) items.push({ text: mm[2], sub: [] });
        else if (items.length)
          items[items.length - 1].sub.push(lines[i].replace(/^\s{2,4}/, ""));
        else break;
        i++;
      }
      out.push(
        `<${ordered ? "ol" : "ul"}>${items.map((it) => `<li>${inline(it.text)}${it.sub.length ? renderMarkdown(it.sub.join("\n"), depth + 1, ctx) : ""}</li>`).join("")}</${ordered ? "ol" : "ul"}>`,
      );
      continue;
    }
    if (line.includes("|") && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim())
        rows.push(cells(lines[i++]));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
      );
      continue;
    }
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !(para.length && blockStart(lines[i]))
    )
      para.push(lines[i++]);
    out.push(`<p>${para.map(inline).join("<br>")}</p>`);
  }
  return out.join("\n");
}

const CLASSES = new Set(["center", "dark", "accent", "big", "top", "light"]);

/**
 * Deck format:  slides separated by a line of `---`;  `Notes:` starts speaker notes (presenter only);
 * optional first line `<!-- class: center dark -->`.  Returns { title, slides:[{ html, notes, classes, text }] }.
 */
export function parseDeck(
  markdown,
  { maxSlides = 200, maxBytes = 200 * 1024 } = {},
) {
  const md = String(markdown ?? "");
  if (Buffer.byteLength(md) > maxBytes)
    throw new HttpError(
      422,
      `Deck is larger than ${Math.round(maxBytes / 1024)} KB`,
    );
  const chunks = [[]];
  let fence = false;
  for (const line of md.replace(/\r\n?/g, "\n").split("\n")) {
    if (isFence(line)) fence = !fence;
    if (!fence && /^\s*-{3,}\s*$/.test(line)) chunks.push([]);
    else chunks[chunks.length - 1].push(line);
  }
  const slides = [];
  for (const lines of chunks) {
    if (!lines.some((l) => l.trim())) continue;
    let classes = "";
    const first = lines.findIndex((l) => l.trim());
    const dm = /^\s*<!--\s*class:\s*([\w\s-]+?)\s*-->\s*$/.exec(
      lines[first] || "",
    );
    if (dm) {
      classes = dm[1]
        .split(/\s+/)
        .filter((c) => CLASSES.has(c))
        .join(" ");
      lines.splice(first, 1);
    }
    let f = false,
      ni = -1;
    for (let k = 0; k < lines.length; k++) {
      if (isFence(lines[k])) f = !f;
      if (!f && /^\s*notes?:\s*/i.test(lines[k])) {
        ni = k;
        break;
      }
    }
    const body = ni < 0 ? lines : lines.slice(0, ni);
    const notes =
      ni < 0
        ? ""
        : [
            lines[ni].replace(/^\s*notes?:\s*/i, ""),
            ...lines.slice(ni + 1),
          ].join("\n");
    slides.push({
      html: renderMarkdown(body.join("\n")),
      notes: notes.trim() ? renderMarkdown(notes) : "",
      classes,
      text: body.join(" ").slice(0, 200),
    });
    if (slides.length > maxSlides)
      throw new HttpError(422, `A deck may have at most ${maxSlides} slides`);
  }
  const title = /^#\s+(.+)$/m.exec(md)?.[1]?.trim() || "";
  return { title, slides };
}

/** Documentation page: heading anchors, highlighted code, table of contents (h2/h3) and plain text for search. */
export function renderDoc(markdown) {
  const ctx = { ids: true, highlight: true, used: new Set(), headings: [] };
  const html = renderMarkdown(markdown, 0, ctx);
  const title = ctx.headings.find((h) => h.level === 1)?.text || "";
  const text = String(markdown)
    .replace(/```[\s\S]*?```/g, (b) => b.replace(/```\w*/g, " "))
    .replace(/[#>*_`|~-]+/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return {
    html,
    title,
    toc: ctx.headings.filter((h) => h.level === 2 || h.level === 3),
    text,
  };
}
