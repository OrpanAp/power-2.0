export async function up(db) {
  await db.schema.createTable("system_logs", (t) => {
    t.id();
    t.string("level", 10).notNull().default("info");
    t.string("message", 500).notNull();
    t.text("context").notNull();
    t.bigInteger("user_id");
    t.string("created_at", 40).notNull();
    t.index("created_at");
    t.index("level");
  });
}
export async function down(db) {
  await db.schema.dropTable("system_logs");
}
