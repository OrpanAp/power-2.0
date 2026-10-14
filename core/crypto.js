import crypto from "node:crypto";
import { config } from "../config/config.js";

// Data-at-rest encryption (AES-256-GCM) with a key derived from SESSION_SECRET via HKDF. Rotating the secret invalidates stored values.
const key = Buffer.from(
  crypto.hkdfSync(
    "sha256",
    config.secret,
    "power-salt-v1",
    "power-data-encryption",
    32,
  ),
);

export function encrypt(plain) {
  const iv = crypto.randomBytes(12),
    c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return ["v1", iv, c.getAuthTag(), ct]
    .map((x, i) => (i ? x.toString("base64url") : x))
    .join(".");
}
export function decrypt(token) {
  try {
    const [v, iv, tag, ct] = String(token).split(".");
    if (v !== "v1") return null;
    const d = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "base64url"),
    );
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      d.update(Buffer.from(ct, "base64url")),
      d.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
