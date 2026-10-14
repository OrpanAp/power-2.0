import { db } from "./database.js";

const empty = (v) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const size = (v, numeric) =>
  numeric
    ? Number(v)
    : typeof v === "number"
      ? v
      : Array.isArray(v)
        ? v.length
        : String(v).length;

const RULES = {
  required: (v) => !empty(v),
  string: (v) => typeof v === "string",
  numeric: (v) => v !== "" && v !== null && !Number.isNaN(Number(v)),
  integer: (v) => /^-?\d+$/.test(String(v)),
  boolean: (v) =>
    [true, false, 0, 1, "0", "1", "true", "false", "on", "off"].includes(v),
  email: (v) =>
    typeof v === "string" &&
    v.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  url: (v) => {
    try {
      const u = new URL(String(v));
      return ["http:", "https:"].includes(u.protocol);
    } catch {
      return false;
    }
  },
  alpha: (v) => /^[A-Za-z]+$/.test(String(v)),
  alpha_num: (v) => /^[A-Za-z0-9]+$/.test(String(v)),
  alpha_dash: (v) => /^[A-Za-z0-9_-]+$/.test(String(v)),
  date: (v) => !Number.isNaN(Date.parse(String(v))),
  min: (v, [n], _d, o) => size(v, o.numeric) >= Number(n),
  max: (v, [n], _d, o) => size(v, o.numeric) <= Number(n),
  between: (v, [a, b], _d, o) =>
    size(v, o.numeric) >= Number(a) && size(v, o.numeric) <= Number(b),
  in: (v, list) => list.includes(String(v)),
  not_in: (v, list) => !list.includes(String(v)),
  same: (v, [f], d) => v === d[f],
  different: (v, [f], d) => v !== d[f],
  // Case-insensitive on every dialect; table/column come from developer-written rules and are validated by db.q().
  unique: async (v, [table, col, ignoreId]) => {
    const sql =
      `SELECT 1 AS x FROM ${db.q(table)} WHERE LOWER(${db.q(col)}) = LOWER(?)` +
      (ignoreId ? ` AND ${db.q("id")} != ?` : "") +
      " LIMIT 1";
    return !(await db.get(sql, ignoreId ? [String(v), ignoreId] : [String(v)]));
  },
  exists: async (v, [table, col]) =>
    !!(await db.get(
      `SELECT 1 AS x FROM ${db.q(table)} WHERE ${db.q(col)} = ? LIMIT 1`,
      [v],
    )),
};

const MESSAGES = {
  required: "The :field field is required.",
  string: "The :field must be text.",
  numeric: "The :field must be a number.",
  integer: "The :field must be an integer.",
  boolean: "The :field must be true or false.",
  email: "The :field must be a valid email address.",
  url: "The :field must be a valid http(s) URL.",
  alpha: "The :field may only contain letters.",
  alpha_num: "The :field may only contain letters and numbers.",
  alpha_dash:
    "The :field may only contain letters, numbers, dashes and underscores.",
  date: "The :field must be a valid date.",
  min: "The :field must be at least :0.",
  max: "The :field may not be greater than :0.",
  between: "The :field must be between :0 and :1.",
  in: "The selected :field is invalid.",
  not_in: "The selected :field is invalid.",
  same: "The :field and :0 must match.",
  different: "The :field and :0 must be different.",
  unique: "The :field has already been taken.",
  exists: "The selected :field does not exist.",
};
const CUSTOM = {};

export class Validator {
  constructor(data, rules, messages = {}) {
    this.data = data || {};
    this.rules = rules;
    this.messages = messages;
    this.errors = {};
    this._types = {};
  }
  /** Async because rules like unique/exists hit the database:  const v = await Validator.make(body, {...}) */
  static async make(data, rules, messages) {
    const v = new Validator(data, rules, messages);
    await v._run();
    return v;
  }
  /** Register a custom rule: fn(value, args, data) => boolean */
  static extend(name, fn, message) {
    CUSTOM[name] = fn;
    MESSAGES[name] = message || `The :field is invalid.`;
  }

  async _run() {
    for (const [field, spec] of Object.entries(this.rules)) {
      const list = (Array.isArray(spec) ? spec : String(spec).split("|"))
        .filter(Boolean)
        .map((r) => {
          if (typeof r === "function")
            return { name: "custom", fn: r, args: [] };
          const i = r.indexOf(":");
          return i < 0
            ? { name: r, args: [] }
            : { name: r.slice(0, i), args: r.slice(i + 1).split(",") };
        });
      const names = list.map((r) => r.name);
      const numeric = names.includes("numeric") || names.includes("integer");
      this._types[field] = names.includes("integer")
        ? "int"
        : names.includes("numeric")
          ? "num"
          : names.includes("boolean")
            ? "bool"
            : null;
      const value = this.data[field];
      if (empty(value) && !names.includes("required")) continue;
      for (const r of list) {
        if (r.name === "nullable" || r.name === "sometimes") continue;
        let ok, msg;
        if (r.fn) {
          const res = await r.fn(value, this.data);
          ok = res === true;
          msg =
            typeof res === "string" ? res : `The ${field} field is invalid.`;
        } else {
          const fn = RULES[r.name] || CUSTOM[r.name];
          if (!fn) throw new Error(`Unknown validation rule: ${r.name}`);
          ok = await fn(value, r.args, this.data, { numeric });
          msg =
            this.messages[`${field}.${r.name}`] ||
            this.messages[r.name] ||
            MESSAGES[r.name] ||
            "The :field is invalid.";
          msg = msg
            .replace(":field", field.replace(/_/g, " "))
            .replace(/:(\d)/g, (_, i) => r.args[i] ?? "");
        }
        if (!ok) {
          (this.errors[field] ||= []).push(msg);
          break;
        }
      }
    }
  }
  fails() {
    return Object.keys(this.errors).length > 0;
  }
  passes() {
    return !this.fails();
  }
  /** Only the fields that have rules, cast to the type implied by their rules. */
  validated() {
    const out = {};
    for (const f of Object.keys(this.rules)) {
      if (!(f in this.data)) continue;
      let v = this.data[f];
      const t = this._types[f];
      if (t === "int" || t === "num") v = empty(v) ? null : Number(v);
      else if (t === "bool") v = [true, 1, "1", "true", "on"].includes(v);
      out[f] = v;
    }
    return out;
  }
}
