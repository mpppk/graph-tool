import "./styles.css";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createRoot } from "react-dom/client";
import type { RouterClient } from "@orpc/server";
import type { router } from "./router";
import type { Graph } from "./db/schema";

// ── oRPC client (HTTP) ────────────────────────────────────────────────────────

// RouterClient<T> maps server-side procedures to callable async functions.
const orpc = createORPCClient<RouterClient<typeof router>>(new RPCLink({ url: "/orpc" }));
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5_000 } } });

// ── Components ────────────────────────────────────────────────────────────────

function GraphList() {
  const qc = useQueryClient();

  const { data: graphs = [], isLoading, error } = useQuery<Graph[]>({
    queryKey: ["graphs"],
    queryFn: () => orpc.graph.list(),
  });

  const createGraph = useMutation({
    mutationFn: (name: string) => orpc.graph.create({ name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["graphs"] }),
  });

  const deleteGraph = useMutation({
    mutationFn: (id: string) => orpc.graph.delete({ id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["graphs"] }),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center p-8 text-slate-400">Loading…</div>;
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 p-4 text-red-600">
        Error: {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-800">Graphs</h2>
        <button
          type="button"
          disabled={createGraph.isPending}
          onClick={() => {
            const name = prompt("Graph name:");
            if (name?.trim()) createGraph.mutate(name.trim());
          }}
          className="rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {createGraph.isPending ? "Creating…" : "+ New Graph"}
        </button>
      </div>

      {graphs.length === 0 ? (
        <p className="py-8 text-center text-slate-400">No graphs yet. Create one to get started.</p>
      ) : (
        <ul className="space-y-2">
          {graphs.map((g) => (
            <li
              key={g.id}
              className="flex items-start justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
            >
              <div>
                <div className="font-medium text-slate-800">{g.name}</div>
                {g.description && (
                  <div className="mt-1 text-sm text-slate-500">{g.description}</div>
                )}
                <div className="mt-2 font-mono text-xs text-slate-400">{g.createdAt}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete "${g.name}"?`)) deleteGraph.mutate(g.id);
                }}
                className="ml-4 rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white px-6 py-4">
          <h1 className="text-2xl font-bold text-slate-900">graph-tool</h1>
          <p className="text-sm text-slate-500">Graph &amp; Network Manager</p>
        </header>
        <main className="mx-auto max-w-4xl px-6 py-8">
          <GraphList />
        </main>
      </div>
    </QueryClientProvider>
  );
}

// ── Mount ─────────────────────────────────────────────────────────────────────

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");
createRoot(root).render(<App />);
