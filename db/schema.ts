import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const auras = sqliteTable("auras", {
  id: text("id").primaryKey(),
  collection: text("collection").notNull(),
  imageKey: text("image_key").notNull(),
  arUrl: text("ar_url").notNull(),
  objects: text("objects").notNull(),
  createdAt: integer("created_at").notNull(),
});
