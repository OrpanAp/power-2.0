import crypto from "node:crypto";
import { promisify } from "node:util";
import { config } from "../config/config.js";
import { HttpError } from "./errors.js";

const scrypt = promisify(crypto.scrypt);

/* ---------- Sanitization ---------- */
const ESC = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
};
export const escapeHtml = (v) =>
  (v === null || v === undefined ? "" : String(v)).replace(
    /[&<>"'`]/g,
    (c) => ESC[c],
  );
export const stripTags = (s) => String(s ?? "").replace(/<[^>]*>?/g, "");

const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

/** Deep-clean untrusted input: strips control chars/NUL, trims (except secrets), blocks prototype pollution. */
export function sanitizeInput(value, key = "", depth = 0) {
  if (depth > 8) throw new HttpError(400, "Request data is nested too deeply");
  if (typeof value === "string") {
    let v = value.replace(CTRL, "").normalize("NFC");
    if (!/pass|token|secret|_csrf/i.test(key)) v = v.trim();
    return v;
  }
  if (Array.isArray(value))
    return value.map((v) => sanitizeInput(v, key, depth + 1));
  if (value && typeof value === "object") {
    const out = Object.create(null);
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN.has(k)) continue;
      out[k] = sanitizeInput(v, k, depth + 1);
    }
    return out;
  }
  return value;
}

/* ---------- Tokens ---------- */
export const randomToken = (bytes = 32) =>
  crypto.randomBytes(bytes).toString("base64url");
export function safeEqual(a, b) {
  const A = Buffer.from(String(a)),
    B = Buffer.from(String(b));
  if (A.length !== B.length) {
    crypto.timingSafeEqual(A, A);
    return false;
  }
  return crypto.timingSafeEqual(A, B);
}

/* ---------- Password hashing (scrypt, optional pepper) ---------- */
const N = 2 ** 15,
  R = 8,
  P = 1,
  KEYLEN = 64,
  MAXMEM = 128 * 1024 * 1024;
// With PASSWORD_PEPPER set, the password is HMAC'd with a server-side secret before scrypt ("scryptp" hashes).
const prehash = (pw, peppered) =>
  peppered
    ? crypto
        .createHmac("sha256", config.pepper)
        .update(String(pw))
        .digest("base64")
    : String(pw);

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16),
    peppered = !!config.pepper;
  const key = await scrypt(prehash(password, peppered), salt, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM,
  });
  return `${peppered ? "scryptp" : "scrypt"}$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}
export async function verifyPassword(password, stored) {
  try {
    const [alg, n, r, p, s, k] = String(stored).split("$");
    if (alg !== "scrypt" && alg !== "scryptp") return false;
    if (alg === "scryptp" && !config.pepper) return false;
    const expected = Buffer.from(k, "base64");
    const key = await scrypt(
      prehash(password, alg === "scryptp"),
      Buffer.from(s, "base64"),
      expected.length,
      { N: +n, r: +r, p: +p, maxmem: MAXMEM },
    );
    return crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}
/** True when a stored hash uses weaker parameters (or lacks the pepper) than the current policy → rehash on next login. */
export function needsRehash(stored) {
  const [alg, n, r, p] = String(stored).split("$");
  return (alg === "scrypt" && !!config.pepper) || +n < N || +r < R || +p < P;
}
export const randomPassword = (len = 16) =>
  crypto.randomBytes(len).toString("base64url").slice(0, len);
export const sha256hex = (s) =>
  crypto.createHash("sha256").update(String(s)).digest("hex");
