import "./styles.css";
import "@xyflow/react/dist/style.css";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge as RFEdge,
  type Node as RFNode,
  type OnConnect,
} from "@xyflow/react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import ELK from "elkjs/lib/elk.bundled.js";
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Graph } from "./db/schema";
import type { router } from "./router";

// ── oRPC client ───────────────────────────────────────────────────────────────

// RPCLink requires an absolute URL; resolve /orpc against the current page origin.
const orpc = createORPCClient<RouterClient<typeof router>>(
  new RPCLink({ url: new URL("/orpc", window.location.href).href }),
);
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5_000 } } });

// ── ELK layout ────────────────────────────────────────────────────────────────

const elk = new ELK();

async function computeElkLayout(
  nodes: RFNode[],
  edges: RFEdge[],
): Promise<Map<string, { x: number; y: number }>> {
  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "60",
    },
    children: nodes.map((n) => ({ id: n.id, width: 160, height: 40 })),
    edges: edges.map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  };
  const layout = await elk.layout(graph);
  const positions = new Map<string, { x: number; y: number }>();
  for (const child of layout.children ?? []) {
    if (child.x !== undefined && child.y !== undefined) {
      positions.set(child.id, { x: child.x, y: child.y });
    }
  }
  return positions;
}

// ── GraphCanvas — React Flow canvas (mounts only after data is loaded) ────────
//
// Pattern: outer GraphView fetches data and shows loading;
// inner GraphCanvas receives fully-loaded initialNodes/initialEdges so
// useNodesState/useEdgesState are never initialized with empty arrays that
// change reference on every render (which would cause an infinite update loop).

function GraphCanvas({
  graph,
  onBack,
  initialNodes,
  initialEdges,
}: {
  graph: Graph;
  onBack: () => void;
  initialNodes: RFNode[];
  initialEdges: RFEdge[];
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const updatePosition = useMutation({
    mutationFn: ({ id, x, y }: { id: string; x: number; y: number }) =>
      orpc.node.updatePosition({ id, x, y }),
  });

  const createNode = useMutation({
    mutationFn: (label: string) =>
      orpc.node.create({
        graphId: graph.id,
        label,
        x: Math.random() * 400,
        y: Math.random() * 300,
      }),
    onSuccess: (newNode) => {
      setNodes((prev) => [
        ...prev,
        { id: newNode.id, position: { x: newNode.x, y: newNode.y }, data: { label: newNode.label } },
      ]);
    },
  });

  const createEdge = useMutation({
    mutationFn: ({ sourceNodeId, targetNodeId }: { sourceNodeId: string; targetNodeId: string }) =>
      orpc.edge.create({ graphId: graph.id, sourceNodeId, targetNodeId }),
  });

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge(connection, eds));
      if (connection.source && connection.target) {
        createEdge.mutate({ sourceNodeId: connection.source, targetNodeId: connection.target });
      }
    },
    [setEdges, createEdge],
  );

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, node: RFNode) => {
      updatePosition.mutate({ id: node.id, x: node.position.x, y: node.position.y });
    },
    [updatePosition],
  );

  const handleAutoLayout = useCallback(async () => {
    if (nodes.length === 0) return;
    const positions = await computeElkLayout(nodes, edges);
    const updated = nodes.map((n) => {
      const pos = positions.get(n.id);
      return pos ? { ...n, position: pos } : n;
    });
    setNodes(updated);
    for (const n of updated) {
      updatePosition.mutate({ id: n.id, x: n.position.x, y: n.position.y });
    }
  }, [nodes, edges, setNodes, updatePosition]);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded px-3 py-1 text-sm text-slate-600 hover:bg-slate-100"
        >
          ← Back
        </button>
        <h1 className="font-semibold text-slate-800">{graph.name}</h1>
        {graph.description && (
          <span className="text-sm text-slate-400">{graph.description}</span>
        )}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={handleAutoLayout}
            className="rounded-lg border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
          >
            Auto Layout
          </button>
          <button
            type="button"
            disabled={createNode.isPending}
            onClick={() => {
              const label = prompt("Node label:");
              if (label?.trim()) createNode.mutate(label.trim());
            }}
            className="rounded-lg bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            + Add Node
          </button>
        </div>
      </header>

      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStop={onNodeDragStop}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    </div>
  );
}

// ── GraphView — fetches data, shows loading, then mounts GraphCanvas ──────────

function GraphView({ graph, onBack }: { graph: Graph; onBack: () => void }) {
  const { data: dbNodes, isLoading: nodesLoading } = useQuery({
    queryKey: ["nodes", graph.id],
    queryFn: () => orpc.node.list({ graphId: graph.id }),
  });
  const { data: dbEdges, isLoading: edgesLoading } = useQuery({
    queryKey: ["edges", graph.id],
    queryFn: () => orpc.edge.list({ graphId: graph.id }),
  });

  if (nodesLoading || edgesLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-400">
        Loading graph…
      </div>
    );
  }

  const initialNodes: RFNode[] = (dbNodes ?? []).map((n) => ({
    id: n.id,
    position: { x: n.x, y: n.y },
    data: { label: n.label },
  }));
  const initialEdges: RFEdge[] = (dbEdges ?? []).map((e) => ({
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    label: e.label || undefined,
  }));

  return (
    <GraphCanvas
      key={graph.id}
      graph={graph}
      onBack={onBack}
      initialNodes={initialNodes}
      initialEdges={initialEdges}
    />
  );
}

// ── GraphList ─────────────────────────────────────────────────────────────────

function GraphList({ onSelect }: { onSelect: (graph: Graph) => void }) {
  const qc = useQueryClient();

  const {
    data: graphs = [],
    isLoading,
    error,
  } = useQuery<Graph[]>({
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
              <button type="button" onClick={() => onSelect(g)} className="text-left">
                <div className="font-medium text-blue-600 hover:underline">{g.name}</div>
                {g.description && (
                  <div className="mt-1 text-sm text-slate-500">{g.description}</div>
                )}
                <div className="mt-2 font-mono text-xs text-slate-400">{g.createdAt}</div>
              </button>
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

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  const [selectedGraph, setSelectedGraph] = useState<Graph | null>(null);

  return (
    <QueryClientProvider client={queryClient}>
      {selectedGraph ? (
        <GraphView graph={selectedGraph} onBack={() => setSelectedGraph(null)} />
      ) : (
        <div className="min-h-screen bg-slate-50">
          <header className="border-b border-slate-200 bg-white px-6 py-4">
            <h1 className="text-2xl font-bold text-slate-900">graph-tool</h1>
            <p className="text-sm text-slate-500">Graph &amp; Network Manager</p>
          </header>
          <main className="mx-auto max-w-4xl px-6 py-8">
            <GraphList onSelect={setSelectedGraph} />
          </main>
        </div>
      )}
    </QueryClientProvider>
  );
}

// ── Mount ─────────────────────────────────────────────────────────────────────

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");
createRoot(root).render(<App />);
