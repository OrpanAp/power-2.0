export async function up(db) {
  await db.schema.createTable("users", (t) => {
    t.id();
    t.string("name", 80).notNull();
    t.string("email", 190).notNull().unique(); // stored lowercase
    t.string("password_hash", 255).notNull();
    t.string("role", 20)
      .notNull()
      .default("user")
      .check("role IN ('admin','user')");
    t.integer("is_active").notNull().default(1);
    t.string("last_login_at", 40);
    t.timestamps();
    t.index("role");
  });
}
export async function down(db) {
  await db.schema.dropTable("users");
}
