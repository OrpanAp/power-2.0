export async function up(db) {
  await db.schema.createTable("presentations", (t) => {
    t.id();
    t.string("slug", 80).notNull().unique();
    t.string("title", 200).notNull();
    t.text("markdown").notNull();
    t.string("theme", 20).notNull().default("light");
    t.integer("is_public").notNull().default(0);
    t.bigInteger("created_by");
    t.timestamps();
    t.foreign("created_by", "users", "id", "SET NULL");
    t.index("is_public");
  });
}
export async function down(db) {
  await db.schema.dropTable("presentations");
}
