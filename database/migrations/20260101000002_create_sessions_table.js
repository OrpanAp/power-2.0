export async function up(db) {
  await db.schema.createTable("sessions", (t) => {
    t.string("id", 64).primary();
    t.bigInteger("user_id");
    t.text("data").notNull();
    t.bigInteger("created_at").notNull();
    t.bigInteger("expires_at").notNull();
    t.foreign("user_id", "users", "id", "CASCADE");
    t.index("expires_at");
    t.index("user_id");
  });
}
export async function down(db) {
  await db.schema.dropTable("sessions");
}
