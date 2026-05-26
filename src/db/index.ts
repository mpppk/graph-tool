import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { runMigrations } from "./migrate";
import { resolveDbPath } from "./path";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (_db) return _db;

  const sqlite = new Database(resolveDbPath(), { create: true });
  sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.run("PRAGMA foreign_keys = ON");

  runMigrations(sqlite);

  _db = drizzle(sqlite, { schema });
  return _db;
}

export { schema };
