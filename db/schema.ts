import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const userProgress = sqliteTable("user_progress", {
  userId: text("user_id").primaryKey(),
  progressJson: text("progress_json").notNull(),
  revision: integer("revision").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});
