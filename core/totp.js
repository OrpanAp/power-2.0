import crypto from "node:crypto";
import { safeEqual } from "./security.js";

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(buf) {
  let bits = 0,
    val = 0,
    out = "";
  for (const b of buf) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHA[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += ALPHA[(val << (5 - bits)) & 31];
  return out;
}
export function base32Decode(str) {
  let bits = 0,
    val = 0;
  const out = [];
  for (const ch of String(str)
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, "")) {
    val = (val << 5) | ALPHA.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export const generateSecret = () => base32Encode(crypto.randomBytes(20));

/** RFC 4226 HOTP (SHA-1, 6 digits). */
export function hotp(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto
    .createHmac("sha1", base32Decode(secret))
    .update(msg)
    .digest();
  const o = h[19] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
/** RFC 6238 TOTP check with ±1 step tolerance. Returns the matched time-step (use it to block replays) or null. */
export function verifyTotp(secret, code, lastStep = 0, now = Date.now()) {
  if (!/^\d{6}$/.test(String(code))) return null;
  const cur = Math.floor(now / 30000);
  let hit = null;
  for (const w of [-1, 0, 1]) {
    const step = cur + w;
    if (safeEqual(hotp(secret, step), code) && step > lastStep) hit = step;
  }
  return hit;
}
export const otpauthUri = ({ secret, account, issuer }) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
