import { parseArgs } from "node:util";
import { createRouterClient } from "@orpc/server";
import { APP_VERSION } from "./runtime-config";
import { router } from "./router";

const HELP = `
graph-tool v${APP_VERSION}

USAGE
  graph-tool                           Start the web UI
  graph-tool graph list                List all graphs
  graph-tool graph create --name <n>   Create a new graph
  graph-tool --version                 Print version
  graph-tool --help                    Show this help
`;

function printTable(rows: Record<string, unknown>[]): void {
  if (rows.length === 0) {
    console.log("(no results)");
    return;
  }
  const keys = Object.keys(rows[0]!);
  const widths = keys.map((k) =>
    Math.max(k.length, ...rows.map((r) => String(r[k] ?? "").length)),
  );
  const pad = (s: string, w: number) => s.padEnd(w);
  console.log(keys.map((k, i) => pad(k, widths[i]!)).join("  "));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) {
    console.log(keys.map((k, i) => pad(String(row[k] ?? ""), widths[i]!)).join("  "));
  }
}

export async function runCli(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
      name: { type: "string" },
      description: { type: "string" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.version) {
    console.log(`graph-tool v${APP_VERSION}`);
    process.exit(0);
  }

  if (values.help || argv.length === 0) {
    console.log(HELP);
    process.exit(0);
  }

  // In-process oRPC client — no HTTP roundtrip needed
  const client = createRouterClient(router, { context: {} });

  const [entity, action] = positionals as [string?, string?];

  if (entity === "graph") {
    if (action === "list" || !action) {
      const graphs = await client.graph.list();
      printTable(graphs as Record<string, unknown>[]);
      return;
    }
    if (action === "create") {
      const name = typeof values.name === "string" ? values.name : undefined;
      const description = typeof values.description === "string" ? values.description : undefined;
      if (!name) {
        console.error("Error: --name is required");
        process.exit(1);
      }
      const graph = await client.graph.create({
        name,
        description: description ?? "",
      });
      console.log(`Created graph: ${graph.id}  "${graph.name}"`);
      return;
    }
  }

  console.log(HELP);
  process.exit(1);
}

export function handleCliError(err: unknown): never {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
