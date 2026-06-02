import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { runMigrations, runMigrationsAsync } from "./migrate";
import { resolveDbPath } from "./path";
import * as schema from "./schema";

type Db = LibSQLDatabase<typeof schema>;

let _db: Db | null = null;
let _dbInit: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  if (_db) return Promise.resolve(_db);
  if (_dbInit) return _dbInit;
  _dbInit = createDb().then((db) => {
    _db = db;
    return db;
  });
  return _dbInit;
}

async function createDb(): Promise<Db> {
  const tursoUrl = process.env.TURSO_URL;

  if (tursoUrl) {
    const { createClient } = await import("@libsql/client");
    const { drizzle } = await import("drizzle-orm/libsql");
    const authToken = process.env.TURSO_AUTH_TOKEN ?? "";
    if (!authToken) console.warn("[db] TURSO_AUTH_TOKEN not set — writes may fail");
    const client = createClient({ url: tursoUrl, authToken });
    await runMigrationsAsync(client);
    return drizzle(client, { schema });
  }

  // ローカル bun:sqlite パス（バイナリ・CLI・CI smoke test はここを通る）
  const { Database } = await import("bun:sqlite");
  const { drizzle } = await import("drizzle-orm/bun-sqlite");
  const sqlite = new Database(resolveDbPath(), { create: true });
  sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.run("PRAGMA foreign_keys = ON");
  runMigrations(sqlite);
  return drizzle(sqlite, { schema }) as unknown as Db;
}

export { schema };
