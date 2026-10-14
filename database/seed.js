import { User } from "../app/models/User.js";
import { Presentation } from "../app/models/Presentation.js";
import { Logger } from "../core/logger.js";
import { hashPassword, randomPassword } from "../core/security.js";
import { checkPassword } from "../core/passwordPolicy.js";
import { config } from "../config/config.js";
import fs from "node:fs";
import path from "node:path";

const FENCE = "```";
const DEMO = `<!-- class: center dark -->
# Welcome to P.O.W.E.R.

A zero-dependency framework — presented live

Notes: Say hello. Ask everyone to open /live/welcome on their phone, then click Start in the presenter view.

---

## How it works

- Write slides in **Markdown**
- Present from ${"`"}/present/welcome${"`"}
- The audience follows live at ${"`"}/live/welcome${"`"}
- Browse freely, jump back with **Return to live**

Notes: Mention that notes like these are never sent to the audience.

---

## Reactions

> Tap an emoji — the presenter sees it instantly.

| Feature | Status |
|---|---|
| Speaker notes | yes |
| Live viewer count | yes |
| Zero dependencies | yes |

---

## Try it

${FENCE}bash
node bin/power-cli.js serve
${FENCE}

Edit this deck in **/admin/presentations** — viewers update instantly.

---

<!-- class: center accent big -->
# Questions?
`;

async function seedDemoDeck(adminId) {
  if ((await Presentation.count()) > 0) return; // also upgrades existing installs
  await Presentation.create({
    slug: "welcome",
    title: "Welcome to P.O.W.E.R.",
    markdown: DEMO,
    theme: "light",
    is_public: 1,
    created_by: adminId,
  });
}

/** Idempotent: creates the initial admin (if none exists), first system logs, and a demo deck. */
export async function seed({ quiet = false } = {}) {
  const existing = await User.first({ role: "admin" });
  if (existing) {
    await seedDemoDeck(existing.id);
    return null;
  }

  const email = (
    process.env.POWER_ADMIN_EMAIL || "admin@power.local"
  ).toLowerCase();
  const generated = !process.env.POWER_ADMIN_PASSWORD;
  const password = process.env.POWER_ADMIN_PASSWORD || randomPassword(20);
  const weak = !generated && checkPassword(password, { email });
  if (weak)
    throw new Error(
      `POWER_ADMIN_PASSWORD rejected by password policy: ${weak}`,
    );
  const admin = await User.create({
    name: "Administrator",
    email,
    password_hash: await hashPassword(password),
    role: "admin",
    is_active: 1,
    password_changed_at: new Date().toISOString(),
  });
  await Logger.info("System initialized", {
    framework: "P.O.W.E.R.",
    node: process.version,
  });
  await Logger.info("Initial admin user created", { email }, admin.id);
  await seedDemoDeck(admin.id);
  // Development convenience only (never production/test): keep a generated password recoverable.
  // `node bin/power-cli.js admin:info` shows it. The file is 0600 and git-ignored; delete it once you've changed the password.
  if (generated && config.env === "development") {
    try {
      fs.mkdirSync(config.paths.storage, { recursive: true });
      fs.writeFileSync(
        path.join(config.paths.storage, ".admin-credentials"),
        `email: ${email}\npassword: ${password}\n`,
        { mode: 0o600 },
      );
    } catch {
      /* read-only fs */
    }
  }
  if (!quiet) {
    console.log("\n  ┌─ Initial admin account ─────────────────────");
    console.log(`  │ email:    ${email}`);
    console.log(
      `  │ password: ${generated ? password : "(from POWER_ADMIN_PASSWORD)"}`,
    );
    if (generated) console.log("  │ Save it now — it is shown only once.");
    console.log("  └─────────────────────────────────────────────\n");
  }
  return { email, password };
}
