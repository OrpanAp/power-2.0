// NIST SP 800-63B style: length + blocklist + context checks (no arbitrary composition rules).
const COMMON = new Set(
  `password password1 password12 password123 password1234 passw0rd p@ssw0rd p@ssword qwerty qwerty123 qwertyuiop
1234567890 12345678 123456789 1q2w3e4r 1q2w3e4r5t 1qaz2wsx iloveyou letmein welcome welcome1 welcome123 admin admin123 administrator
changeme changeme123 abc123456 abcd1234 monkey123 dragon123 football1 baseball1 superman1 trustno1 sunshine1 princess1 master123
whatever123 zaq12wsx asdfghjkl asdfghjk1 qazwsxedc 0987654321 passpass1 secret123 letmein123 default123 test1234 testtest123 power123
p0werful power-admin adminadmin adminpassword`.split(/\s+/),
);

export function checkPassword(pw, { email = "", name = "" } = {}) {
  pw = String(pw ?? "");
  if (pw.length < 10) return "The password must be at least 10 characters.";
  if (pw.length > 128)
    return "The password may not be longer than 128 characters.";
  const lower = pw.toLowerCase();
  if (COMMON.has(lower) || COMMON.has(lower.replace(/[\d!@#$%^&*._-]+$/, "")))
    return "That password is too common. Choose something less guessable.";
  if (new Set(lower).size < 5) return "The password is too repetitive.";
  if (/^(?:0123456789|1234567890|abcdefghij|qwertyuiop|asdfghjkl)/.test(lower))
    return "The password is a keyboard or number sequence.";
  const local = String(email).split("@")[0].toLowerCase();
  if (local.length >= 4 && lower.includes(local))
    return "The password must not contain your email address.";
  const first = String(name).trim().split(/\s+/)[0]?.toLowerCase();
  if (first && first.length >= 4 && lower.includes(first))
    return "The password must not contain your name.";
  return null;
}
/** Validator rule: password: ['required', passwordRule] */
export const passwordRule = (v, d) =>
  checkPassword(v, { email: d.email, name: d.name }) ?? true;
