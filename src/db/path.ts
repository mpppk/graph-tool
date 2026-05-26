import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { APP_NAME } from "../runtime-config";

function xdgDataHome(): string {
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg?.startsWith("/")) return xdg;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "~";
  return join(home, ".local", "share");
}

export function resolveDbPath(): string {
  const envPath = process.env.GRAPH_TOOL_DB;
  if (envPath) return envPath;
  const dir = join(xdgDataHome(), APP_NAME);
  mkdirSync(dir, { recursive: true });
  return join(dir, "db.sqlite");
}
