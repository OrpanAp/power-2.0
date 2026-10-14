import { escapeHtml as esc } from "./security.js";

/* Tiny dependency-free, server-side syntax highlighter for documentation. Everything is escaped; output is <span class="tok-*"> only. */
const span = (c, s) => `<span class="tok-${c}">${esc(s)}</span>`;
const words = (s) => new Set(s.split(/\s+/));

const JS = words(
  "const let var function return if else for while do class extends new import export from await async static throw try catch finally of in typeof instanceof null true false undefined default switch case break continue this super yield delete void",
);
const SQL = words(
  "select from where and or not insert into values update set delete create table alter add drop index unique primary key foreign references on cascade default null join left right inner outer group by order limit offset as in is like escape check constraint if exists begin commit rollback start transaction returning conflict do duplicate distinct count max min having union all asc desc varchar text integer bigint int bigserial autoincrement auto_increment engine charset",
);
const BASH = words(
  "if then else elif fi for do done while case esac function in export cd echo exit return set unset local",
);

const RE = {
  num: /(?:0x[0-9a-f]+|\d+(?:\.\d+)?)/iy,
  id: /[A-Za-z_$][\w$]*/y,
  bashVar: /\$(?:\{[^}]*\}|[A-Za-z_]\w*|\d)/y,
  flag: /--?[A-Za-z][\w-]*/y,
};
const at = (re, s, i) => {
  re.lastIndex = i;
  return re.exec(s);
};

function scan(
  code,
  {
    kw,
    ci = false,
    line = [],
    block = null,
    quotes = ['"', "'"],
    fn = false,
    bash = false,
  },
) {
  let out = "",
    i = 0;
  const n = code.length;
  while (i < n) {
    const ch = code[i];
    if (block && code.startsWith(block[0], i)) {
      const e = code.indexOf(block[1], i + block[0].length);
      const end = e < 0 ? n : e + block[1].length;
      out += span("c", code.slice(i, end));
      i = end;
      continue;
    }
    const lc = line.find((p) => code.startsWith(p, i));
    if (lc && !(bash && lc === "#" && i > 0 && /\S/.test(code[i - 1]))) {
      const e = code.indexOf("\n", i);
      const end = e < 0 ? n : e;
      out += span("c", code.slice(i, end));
      i = end;
      continue;
    }
    if (quotes.includes(ch)) {
      let j = i + 1;
      while (j < n && code[j] !== ch) {
        if (code[j] === "\\") j++;
        else if (ch !== "`" && code[j] === "\n") break;
        j++;
      }
      j = Math.min(j + 1, n);
      out += span("s", code.slice(i, j));
      i = j;
      continue;
    }
    if (bash) {
      let m = ch === "$" && at(RE.bashVar, code, i);
      if (m) {
        out += span("v", m[0]);
        i += m[0].length;
        continue;
      }
      m =
        ch === "-" &&
        /(^|\s)$/.test(code.slice(Math.max(0, i - 1), i)) &&
        at(RE.flag, code, i);
      if (m) {
        out += span("n", m[0]);
        i += m[0].length;
        continue;
      }
    }
    if (/\d/.test(ch) && !/[\w$]/.test(code[i - 1] || "")) {
      const m = at(RE.num, code, i);
      out += span("n", m[0]);
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const w = at(RE.id, code, i)[0];
      out += kw.has(ci ? w.toLowerCase() : w)
        ? span("k", w)
        : fn && code[i + w.length] === "("
          ? span("f", w)
          : esc(w);
      i += w.length;
      continue;
    }
    out += esc(ch);
    i++;
  }
  return out;
}

function html(code) {
  return esc(code)
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="tok-c">$1</span>')
    .replace(/(&lt;%[\s\S]*?%&gt;)/g, '<span class="tok-k">$1</span>')
    .replace(/(\{\{\{?[\s\S]*?\}\}\}?)/g, '<span class="tok-v">$1</span>')
    .replace(/(&lt;\/?)([A-Za-z][\w-]*)/g, '$1<span class="tok-f">$2</span>')
    .replace(
      /(=)(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g,
      '$1<span class="tok-s">$2</span>',
    );
}
function env(code) {
  return code
    .split("\n")
    .map((l) => {
      if (/^\s*#/.test(l)) return span("c", l);
      const m = /^(\s*(?:export\s+)?)([A-Za-z_][\w.]*)(\s*=\s*)(.*)$/.exec(l);
      return m
        ? esc(m[1]) + span("f", m[2]) + esc(m[3]) + span("s", m[4])
        : esc(l);
    })
    .join("\n");
}

export function highlight(code, lang = "") {
  lang = String(lang).toLowerCase();
  if (["js", "javascript", "mjs", "ts", "jsx"].includes(lang))
    return scan(code, {
      kw: JS,
      line: ["//"],
      block: ["/*", "*/"],
      quotes: ['"', "'", "`"],
      fn: true,
    });
  if (lang === "json")
    return scan(code, { kw: words("true false null"), quotes: ['"'] });
  if (lang === "sql")
    return scan(code, {
      kw: SQL,
      ci: true,
      line: ["--"],
      block: ["/*", "*/"],
      quotes: ["'", '"', "`"],
      fn: true,
    });
  if (["bash", "sh", "shell", "console"].includes(lang))
    return scan(code, { kw: BASH, line: ["#"], bash: true });
  if (["html", "xml", "tpl"].includes(lang)) return html(code);
  if (["env", "ini", "dotenv"].includes(lang)) return env(code);
  return esc(code);
}
