import fs from "node:fs";
import path from "node:path";
import { escapeHtml } from "./security.js";

const TOKEN = /(\{\{\{[\s\S]*?\}\}\}|\{\{[\s\S]*?\}\}|<%[\s\S]*?%>)/;
const EXTENDS = /<%\s*extends\s+["']([^"']+)["']\s*%>/;
const BLOCK = /<%\s*block\s+([\w-]+)\s*%>([\s\S]*?)<%\s*endblock\s*%>/g;
const INCLUDE = /<include\s+([^>]*?)\/?>/gi;

const str = (v) => (v === null || v === undefined ? "" : String(v));
/** Evaluate a template expression; missing variables render as empty instead of crashing the page. */
const tryExpr = (fn) => {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ReferenceError || e instanceof TypeError) return undefined;
    throw e;
  }
};

/**
 * Template engine:
 *   <% extends "layouts/main" %>            inheritance (put at top of child)
 *   <% block name %>...<% endblock %>       overridable regions (<% super %> inside a child block = parent's default)
 *   {{ expr }}  escaped   {{{ expr }}} raw
 *   <include type="html" path="partials/x"> include another template (type="text" inserts the file escaped)
 *   <% if %> <% elseif %> <% else %> <% endif %> <% unless %> <% for item[, i] in list %> <% endfor %>
 */
export class ViewEngine {
  constructor(dir, { cache = false, ext = ".html" } = {}) {
    this.dir = path.resolve(dir);
    this.cache = cache;
    this.ext = ext;
    this._compiled = new Map();
  }
  _file(name) {
    const f = path.resolve(
      this.dir,
      name.endsWith(this.ext) ? name : name + this.ext,
    );
    if (!f.startsWith(this.dir + path.sep))
      throw new Error(`Illegal view path: ${name}`);
    return f;
  }
  _includes(src, depth) {
    return src.replace(INCLUDE, (_, attrs) => {
      const get = (k) =>
        (attrs.match(new RegExp(`${k}\\s*=\\s*["']([^"']+)["']`, "i")) ||
          [])[1];
      const p = get("path"),
        type = (get("type") || "html").toLowerCase();
      if (!p) throw new Error("<include> requires a path attribute");
      if (type === "text")
        return escapeHtml(fs.readFileSync(this._file(p), "utf8"))
          .replace(/\{/g, "&#123;")
          .replace(/%/g, "&#37;");
      return this._resolve(p, depth + 1);
    });
  }
  /** Flatten inheritance + includes into one template source (block markers retained for further overriding). */
  _resolve(name, depth = 0) {
    if (depth > 12) throw new Error(`Template nesting too deep at ${name}`);
    let src = this._includes(fs.readFileSync(this._file(name), "utf8"), depth);
    const m = src.match(EXTENDS);
    if (!m) return src;
    src = src.replace(EXTENDS, "");
    const blocks = new Map();
    for (const b of src.matchAll(BLOCK)) blocks.set(b[1], b[2]);
    return this._resolve(m[1], depth + 1).replace(BLOCK, (_, bname, def) => {
      const child = blocks.get(bname);
      const body =
        child === undefined ? def : child.replace(/<%\s*super\s*%>/g, def);
      return `<% block ${bname} %>${body}<% endblock %>`;
    });
  }
  _directive(d) {
    let m;
    if ((m = d.match(/^if\s+([\s\S]+)$/))) return `if(__t(()=>(${m[1]}))){\n`;
    if ((m = d.match(/^unless\s+([\s\S]+)$/)))
      return `if(!__t(()=>(${m[1]}))){\n`;
    if ((m = d.match(/^(?:elseif|elif)\s+([\s\S]+)$/)))
      return `}else if(__t(()=>(${m[1]}))){\n`;
    if (d === "else") return "}else{\n";
    if (["endif", "endfor", "endunless"].includes(d)) return "}\n";
    if ((m = d.match(/^for\s+(\w+)(?:\s*,\s*(\w+))?\s+in\s+([\s\S]+)$/))) {
      const [, item, idx, list] = m;
      return idx
        ? `for(const [${idx},${item}] of Array.from(__t(()=>(${list}))||[]).entries()){\n`
        : `for(const ${item} of Array.from(__t(()=>(${list}))||[])){\n`;
    }
    throw new Error(`Unknown template directive: <% ${d} %>`);
  }
  _compile(src) {
    let code = 'let __o="";\n';
    for (const p of src.split(TOKEN)) {
      if (!p) continue;
      if (p.startsWith("{{{"))
        code += `__o+=__s(__t(()=>(${p.slice(3, -3).trim()})));\n`;
      else if (p.startsWith("{{"))
        code += `__o+=__e(__t(()=>(${p.slice(2, -2).trim()})));\n`;
      else if (p.startsWith("<%"))
        code += this._directive(p.slice(2, -2).trim());
      else code += `__o+=${JSON.stringify(p)};\n`;
    }
    return new Function(
      "__c",
      "__e",
      "__s",
      "__t",
      `with(__c){${code}return __o;}`,
    );
  }
  render(name, ctx = {}) {
    let fn = this.cache ? this._compiled.get(name) : null;
    if (!fn) {
      const src = this._resolve(name).replace(BLOCK, "$2");
      fn = this._compile(src);
      if (this.cache) this._compiled.set(name, fn);
    }
    return fn(ctx, escapeHtml, str, tryExpr);
  }
}
