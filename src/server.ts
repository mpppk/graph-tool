import { RPCHandler } from "@orpc/server/fetch";
import index from "./index.html";
import { router } from "./router";
import { PORT } from "./runtime-config";

const rpcHandler = new RPCHandler(router);

const sseClients = new Set<ReadableStreamDefaultController>();

export function notifyClients(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const encoded = new TextEncoder().encode(payload);
  for (const ctrl of sseClients) {
    try {
      ctrl.enqueue(encoded);
    } catch {
      sseClients.delete(ctrl);
    }
  }
}

export function startServer(): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({
    port: PORT,

    routes: {
      // ── Server-Sent Events ────────────────────────────────────────────────
      "/events": (req) => {
        let ctrl: ReadableStreamDefaultController;
        const stream = new ReadableStream({
          start(c) {
            ctrl = c;
            sseClients.add(ctrl);
            // Send initial heartbeat
            ctrl.enqueue(new TextEncoder().encode(": connected\n\n"));
          },
          cancel() {
            sseClients.delete(ctrl);
          },
        });

        req.signal.addEventListener("abort", () => {
          sseClients.delete(ctrl);
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            Connection: "keep-alive",
          },
        });
      },

      // ── oRPC API ──────────────────────────────────────────────────────────
      "/orpc/*": async (req) => {
        const result = await rpcHandler.handle(req, { prefix: "/orpc", context: {} });
        if (result.matched) return result.response;
        return new Response("Not found", { status: 404 });
      },

      // ── SPA — Bun bundles index.html + frontend.tsx at build time ─────────
      "/*": index,
    },

    development: process.env.NODE_ENV !== "production",
  });

  console.log(`[graph-tool] Server running at http://localhost:${server.port}`);
  return server;
}
