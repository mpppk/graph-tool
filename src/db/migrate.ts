import type { Database } from "bun:sqlite";

// SQL files are embedded at compile time via Bun's import assertions —
// works in both dev and compiled binary.
import migration0001 from "./migrations/0001_init.sql" with { type: "text" };

const MIGRATIONS: Array<[string, string]> = [["0001_init.sql", migration0001]];

export function runMigrations(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    db
      .query<{ id: string }, []>("SELECT id FROM _migrations")
      .all()
      .map((r) => r.id),
  );

  for (const [name, sql] of MIGRATIONS) {
    if (applied.has(name)) continue;
    db.transaction(() => {
      db.run(sql);
      db.run("INSERT INTO _migrations (id) VALUES (?)", [name]);
    })();
    console.log(`[migrate] Applied: ${name}`);
  }
}
