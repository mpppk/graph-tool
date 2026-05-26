#!/usr/bin/env bun

// Compiled entrypoint: dispatches to CLI or server based on process.argv.
// Dynamic imports keep server deps out of CLI path and vice-versa.

async function main() {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    const { runCli, handleCliError } = await import("./cli");
    await runCli(args).catch(handleCliError);
  } else {
    const { startServer } = await import("./server");
    const server = startServer();
    const url = server.url.href;

    // Open browser after a short delay to let the server bind
    setTimeout(() => {
      const open =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "start"
            : "xdg-open";
      Bun.spawn([open, url], { stdout: "ignore", stderr: "ignore" });
      console.log(`[graph-tool] Opening ${url}`);
    }, 500);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
