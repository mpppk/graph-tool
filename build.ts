// Builds the frontend bundle for production (output to dist/).
// Used as a pre-step before build-binary.ts.
import tailwind from "bun-plugin-tailwind";

const result = await Bun.build({
  entrypoints: ["src/frontend.tsx"],
  outdir: "dist",
  target: "browser",
  plugins: [tailwind],
  minify: true,
  sourcemap: "external",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log("[build] Frontend built to dist/");
