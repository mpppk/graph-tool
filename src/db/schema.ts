import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const graphs = sqliteTable("graphs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const nodes = sqliteTable("nodes", {
  id: text("id").primaryKey(),
  graphId: text("graph_id")
    .notNull()
    .references(() => graphs.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  x: real("x").notNull().default(0),
  y: real("y").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const edges = sqliteTable("edges", {
  id: text("id").primaryKey(),
  graphId: text("graph_id")
    .notNull()
    .references(() => graphs.id, { onDelete: "cascade" }),
  sourceNodeId: text("source_node_id")
    .notNull()
    .references(() => nodes.id, { onDelete: "cascade" }),
  targetNodeId: text("target_node_id")
    .notNull()
    .references(() => nodes.id, { onDelete: "cascade" }),
  label: text("label").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export type Graph = typeof graphs.$inferSelect;
export type NewGraph = typeof graphs.$inferInsert;
export type Node = typeof nodes.$inferSelect;
export type NewNode = typeof nodes.$inferInsert;
export type Edge = typeof edges.$inferSelect;
export type NewEdge = typeof edges.$inferInsert;
