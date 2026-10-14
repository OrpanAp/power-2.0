export async function up(db) {
  await db.schema.alterTable("users", (t) => {
    t.integer("failed_logins").notNull().default(0);
    t.bigInteger("locked_until");
    t.string("password_changed_at", 40);
    t.text("totp_secret"); // AES-256-GCM encrypted (core/crypto.js)
    t.integer("totp_enabled").notNull().default(0);
    t.bigInteger("totp_last_step"); // blocks TOTP replay
    t.text("backup_codes"); // JSON array of SHA-256 hashes
  });
}
export async function down() {
  /* additive migration; columns are kept */
}
