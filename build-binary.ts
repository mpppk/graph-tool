// Compiles the full CLI + Web UI into a single self-contained Bun binary.
// Cross-compile by setting BUN_TARGET env var:
//   BUN_TARGET=bun-linux-arm64 bun run build:binary
import tailwind from "bun-plugin-tailwind";

const targetEnv = Bun.env["BUN_TARGET"] ?? "bun";
const target = targetEnv as Parameters<typeof Bun.build>[0]["target"];
const outfile = `./dist/graph-tool${targetEnv === "bun-windows-x64" ? ".exe" : ""}`;

console.log(`[build-binary] Compiling for target=${target} → ${outfile}`);

const result = await Bun.build({
  entrypoints: ["./src/binary.ts"],
  target,
  compile: { outfile },
  plugins: [tailwind],
  minify: true,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log(`[build-binary] Binary written to ${outfile}`);
