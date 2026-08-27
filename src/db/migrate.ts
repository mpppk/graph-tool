import type { Database } from "bun:sqlite";
import type { Client } from "@libsql/client";

// SQL files are embedded at compile time via Bun's import assertions —
// works in both dev and compiled binary.
import migration0001 from "./migrations/0001_init.sql" with { type: "text" };
import migration0002 from "./migrations/0002_add_node_metadata.sql" with { type: "text" };
import migration0003 from "./migrations/0003_add_node_type.sql" with { type: "text" };

const MIGRATIONS: Array<[string, string]> = [
  ["0001_init.sql", migration0001],
  ["0002_add_node_metadata.sql", migration0002],
  ["0003_add_node_type.sql", migration0003],
];

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

// Splits a SQL string into individual statements.
// Note: future migrations must not contain semicolons inside string literals.
function splitSql(sql: string): string[] {
  return sql
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function runMigrationsAsync(client: Client): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const result = await client.execute("SELECT id FROM _migrations");
  const applied = new Set(result.rows.map((r) => r.id as string));

  for (const [name, sql] of MIGRATIONS) {
    if (applied.has(name)) continue;
    const stmts = splitSql(sql).map((s) => ({ sql: s, args: [] as never[] }));
    stmts.push({ sql: "INSERT INTO _migrations (id) VALUES (?)", args: [name] as never[] });
    await client.batch(stmts, "write");
    console.log(`[migrate] Applied: ${name}`);
  }
}
