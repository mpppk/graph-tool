import "./styles.css";
import "@xyflow/react/dist/style.css";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Background,
  BaseEdge,
  type Connection,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  type EdgeProps,
  type NodeProps,
  type OnConnect,
  Position,
  type Edge as RFEdge,
  type Node as RFNode,
  ReactFlow,
  getBezierPath,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Graph } from "./db/schema";
import type { router } from "./router";

// ── oRPC client ───────────────────────────────────────────────────────────────

const orpc = createORPCClient<RouterClient<typeof router>>(
  new RPCLink({ url: new URL("/orpc", window.location.href).href }),
);
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5_000 } } });

// ── Node types & colors ───────────────────────────────────────────────────────

const NODE_TYPE_COLORS: Record<string, string> = {
  KPI: "#3b82f6",
  Epic: "#8b5cf6",
  Feature: "#22c55e",
  Opportunity: "#f97316",
  Solution: "#14b8a6",
};
const PREDEFINED_NODE_TYPES = Object.keys(NODE_TYPE_COLORS);

// ── ELK layout ────────────────────────────────────────────────────────────────

const elk = new ELK();

type LayoutAlgorithm = {
  id: string;
  label: string;
  elkOptions: Record<string, string>;
};

// 既定（メインボタンで再適用する初期アルゴリズム）
const DEFAULT_LAYOUT_ALGORITHM: LayoutAlgorithm = {
  id: "layered",
  label: "Layered (階層)",
  elkOptions: {
    "elk.algorithm": "layered",
    "elk.direction": "DOWN",
    "elk.spacing.nodeNode": "40",
    "elk.layered.spacing.nodeNodeBetweenLayers": "60",
  },
};

// 再配置で選択できるレイアウトアルゴリズム（ELK 対応）
const LAYOUT_ALGORITHMS: LayoutAlgorithm[] = [
  DEFAULT_LAYOUT_ALGORITHM,
  {
    id: "mrtree",
    label: "Mr.Tree (木)",
    elkOptions: {
      "elk.algorithm": "mrtree",
      "elk.spacing.nodeNode": "40",
    },
  },
  {
    id: "force",
    label: "Force (力学)",
    elkOptions: {
      "elk.algorithm": "force",
      "elk.spacing.nodeNode": "80",
    },
  },
  {
    id: "radial",
    label: "Radial (放射状)",
    elkOptions: {
      "elk.algorithm": "radial",
      "elk.spacing.nodeNode": "60",
    },
  },
  {
    id: "stress",
    label: "Stress",
    elkOptions: {
      "elk.algorithm": "stress",
      "elk.spacing.nodeNode": "80",
    },
  },
];

async function computeElkLayout(
  nodes: RFNode[],
  edges: RFEdge[],
  layoutOptions: Record<string, string>,
): Promise<Map<string, { x: number; y: number }>> {
  const graph = {
    id: "root",
    layoutOptions,
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

// ── Mermaid export ────────────────────────────────────────────────────────────

function generateMermaidDiagram(nodes: RFNode[], edges: RFEdge[]): string {
  const idMap = new Map<string, string>();
  nodes.forEach((n, i) => idMap.set(n.id, `n${i}`));

  function escapeMermaidLabel(text: string): string {
    return text.replace(/"/g, "#quot;").replace(/\|/g, "#124;");
  }

  const nodeLines = nodes.map((n) => {
    const mid = idMap.get(n.id)!;
    const label = escapeMermaidLabel((n.data.label as string) || "(untitled)");
    return `  ${mid}["${label}"]`;
  });

  const edgeLines = edges.flatMap((e) => {
    const src = idMap.get(e.source);
    const tgt = idMap.get(e.target);
    if (!src || !tgt) return [];
    const label = ((e.data?.label as string) ?? "").trim();
    if (label) {
      return [`  ${src} -->|"${escapeMermaidLabel(label)}"| ${tgt}`];
    }
    return [`  ${src} --> ${tgt}`];
  });

  const usedTypes = [
    ...new Set(
      nodes
        .map((n) => n.data.nodeType as string | null | undefined)
        .filter((t): t is string => !!t && t in NODE_TYPE_COLORS),
    ),
  ];

  const classDefLines = usedTypes.map(
    (t) => `  classDef ${t} fill:${NODE_TYPE_COLORS[t]},stroke:none,color:#ffffff`,
  );

  const classAssignLines = usedTypes.flatMap((t) => {
    const matchingIds = nodes
      .filter((n) => n.data.nodeType === t)
      .map((n) => idMap.get(n.id)!)
      .join(",");
    return matchingIds ? [`  class ${matchingIds} ${t}`] : [];
  });

  return [
    "graph TD",
    ...nodeLines,
    ...(edgeLines.length ? [""] : []),
    ...edgeLines,
    ...(classDefLines.length ? [""] : []),
    ...classDefLines,
    ...classAssignLines,
  ].join("\n");
}

// ── EditableNode — カスタムノード（ダブルクリックでインライン編集） ────────────

function EditableNode({ id, data, selected }: NodeProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label as string);
  const inputRef = useRef<HTMLInputElement>(null);
  const { updateNodeData } = useReactFlow();
  const nodeType = data.nodeType as string | null | undefined;
  const bgColor = nodeType ? (NODE_TYPE_COLORS[nodeType] ?? "#ffffff") : "#ffffff";
  const hasTypeColor = !!nodeType && !!NODE_TYPE_COLORS[nodeType];

  const updateLabel = useMutation({
    mutationFn: (label: string) => orpc.node.updateLabel({ id, label }),
    onSuccess: (node) => {
      updateNodeData(id, { label: node.label });
    },
  });

  const commitEdit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== (data.label as string)) {
      updateNodeData(id, { label: trimmed }); // optimistic update
      updateLabel.mutate(trimmed, {
        onError: () => updateNodeData(id, { label: data.label as string }), // rollback on error
      });
    } else {
      setDraft(data.label as string);
    }
    setEditing(false);
  }, [draft, data.label, updateLabel, updateNodeData, id]);

  useEffect(() => {
    if (data.autoEdit) {
      setDraft(data.label as string);
      setEditing(true);
      updateNodeData(id, { ...data, autoEdit: false });
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [data, id, updateNodeData]);

  const handleDoubleClick = useCallback(() => {
    setDraft(data.label as string);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [data.label]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") commitEdit();
      if (e.key === "Escape") {
        setDraft(data.label as string);
        setEditing(false);
      }
    },
    [commitEdit, data.label],
  );

  return (
    <div
      style={{ backgroundColor: bgColor, color: hasTypeColor ? "#ffffff" : undefined }}
      className={`flex min-w-[120px] max-w-[200px] items-center justify-center rounded-md border-2 px-3 py-2 text-sm font-medium shadow-sm ${
        selected ? "border-blue-500" : "border-slate-300"
      }`}
      onDoubleClick={handleDoubleClick}
    >
      <Handle type="target" position={Position.Top} />
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          className={`w-full bg-transparent text-center text-sm outline-none ${hasTypeColor ? "placeholder-white/60" : ""}`}
          // stopPropagation prevents ReactFlow from intercepting keystrokes
          onKeyUp={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="text-center">{data.label as string}</span>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { default: EditableNode };

// ── EditableEdge — カスタムエッジ（ダブルクリックでラベル編集） ───────────────

function EditableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState((data?.label as string) ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const { updateEdgeData } = useReactFlow();

  const updateLabel = useMutation({
    mutationFn: (label: string) => orpc.edge.updateLabel({ id, label }),
    onSuccess: (edge) => {
      updateEdgeData(id, { label: edge.label });
    },
  });

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const commitEdit = useCallback(() => {
    const trimmed = draft.trim();
    const current = (data?.label as string) ?? "";
    if (trimmed !== current) {
      updateEdgeData(id, { label: trimmed });
      updateLabel.mutate(trimmed, {
        onError: () => updateEdgeData(id, { label: current }),
      });
    }
    setEditing(false);
  }, [draft, data?.label, updateLabel, updateEdgeData, id]);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setDraft((data?.label as string) ?? "");
      setEditing(true);
      setTimeout(() => inputRef.current?.select(), 0);
    },
    [data?.label],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") commitEdit();
      if (e.key === "Escape") {
        setDraft((data?.label as string) ?? "");
        setEditing(false);
      }
    },
    [commitEdit, data?.label],
  );

  const label = (data?.label as string) ?? "";

  return (
    <>
      <BaseEdge path={edgePath} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
          className="nodrag nopan"
        >
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={handleKeyDown}
              onKeyUp={(e) => e.stopPropagation()}
              className="rounded border border-blue-400 bg-white px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-blue-400 shadow-sm"
            />
          ) : label ? (
            <span
              onDoubleClick={handleDoubleClick}
              className="cursor-pointer rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 shadow-sm hover:border-blue-300"
            >
              {label}
            </span>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes = { editable: EditableEdge };

// ── SidePanel — 選択ノードの詳細・編集パネル ─────────────────────────────────

function SidePanel({
  nodeId,
  nodes,
  onClose,
  onDeleteNode,
  onUpdateNodeType,
}: {
  nodeId: string;
  nodes: RFNode[];
  onClose: () => void;
  onDeleteNode: (id: string) => void;
  onUpdateNodeType: (nodeId: string, nodeType: string | null) => void;
}) {
  const qc = useQueryClient();
  const node = nodes.find((n) => n.id === nodeId);
  const label = node ? (node.data.label as string) : "";
  const currentNodeType = node ? (node.data.nodeType as string | null | undefined) ?? "" : "";

  const { data: metadata = [] } = useQuery({
    queryKey: ["metadata", nodeId],
    queryFn: () => orpc.node.metadata.list({ nodeId }),
    enabled: !!nodeId,
  });

  const upsertMeta = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      orpc.node.metadata.upsert({ nodeId, key, value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["metadata", nodeId] }),
  });

  const deleteMeta = useMutation({
    mutationFn: (id: string) => orpc.node.metadata.delete({ id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["metadata", nodeId] }),
  });

  // 新規行の入力state
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  // 編集中の行 (id → draft value)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  const handleAddMeta = useCallback(() => {
    const k = newKey.trim();
    const v = newValue.trim();
    if (!k) return;
    upsertMeta.mutate({ key: k, value: v });
    setNewKey("");
    setNewValue("");
  }, [newKey, newValue, upsertMeta]);

  const handleEditStart = useCallback((id: string, value: string) => {
    setEditingId(id);
    setEditDraft(value);
  }, []);

  const handleEditCommit = useCallback(
    (id: string, key: string) => {
      upsertMeta.mutate({ key, value: editDraft });
      setEditingId(null);
    },
    [editDraft, upsertMeta],
  );

  if (!node) return null;

  return (
    <aside className="flex w-72 flex-shrink-0 flex-col border-l border-slate-200 bg-white">
      {/* ヘッダー */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <span className="text-sm font-semibold text-slate-700">Node</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Close panel"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* ラベル（読み取り専用表示。編集はキャンバス上でダブルクリック） */}
        <section>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Label</p>
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
            {label}
          </p>
          <p className="mt-1 text-xs text-slate-400">ダブルクリックでキャンバス上から編集</p>
        </section>

        {/* タイプ */}
        <section>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">タイプ</p>
          <select
            value={currentNodeType}
            onChange={(e) => {
              const val = e.target.value;
              onUpdateNodeType(nodeId, val || null);
            }}
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
          >
            <option value="">なし</option>
            {PREDEFINED_NODE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </section>

        {/* メタデータ */}
        <section>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            Metadata
          </p>

          {metadata.length === 0 && <p className="text-xs text-slate-400">メタデータなし</p>}

          <ul className="space-y-2">
            {metadata.map((m) => (
              <li key={m.id} className="flex items-center gap-2">
                <span className="w-24 shrink-0 truncate rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                  {m.key}
                </span>
                {editingId === m.id ? (
                  <input
                    ref={editInputRef}
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    onBlur={() => handleEditCommit(m.id, m.key)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleEditCommit(m.id, m.key);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="flex-1 rounded border border-blue-400 px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-blue-400"
                  />
                ) : (
                  <button
                    type="button"
                    className="flex-1 truncate rounded px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-50"
                    onClick={() => handleEditStart(m.id, m.value)}
                    title="クリックして編集"
                  >
                    {m.value || <span className="italic text-slate-400">（空）</span>}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => deleteMeta.mutate(m.id)}
                  className="shrink-0 rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-400"
                  aria-label="Delete metadata"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>

          {/* 新規メタデータ追加行 */}
          <div className="mt-3 flex gap-2">
            <input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="key"
              className="w-24 shrink-0 rounded border border-slate-200 px-2 py-1 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddMeta();
              }}
            />
            <input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="value"
              className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddMeta();
              }}
            />
            <button
              type="button"
              onClick={handleAddMeta}
              disabled={!newKey.trim()}
              className="shrink-0 rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-40"
            >
              追加
            </button>
          </div>
        </section>
      </div>

      {/* フッター：削除ボタン */}
      <div className="border-t border-slate-200 p-4">
        <button
          type="button"
          onClick={() => {
            onDeleteNode(nodeId);
          }}
          className="w-full rounded-lg border border-red-200 py-2 text-sm font-medium text-red-500 hover:bg-red-50"
        >
          Delete Node
        </button>
      </div>
    </aside>
  );
}

// ── EdgeSidePanel — 選択エッジの詳細・編集パネル ─────────────────────────────

function EdgeSidePanel({
  edgeId,
  edges,
  onClose,
  onDeleteEdge,
  onUpdateLabel,
}: {
  edgeId: string;
  edges: RFEdge[];
  onClose: () => void;
  onDeleteEdge: (id: string) => void;
  onUpdateLabel: (edgeId: string, label: string) => void;
}) {
  const edge = edges.find((e) => e.id === edgeId);
  const currentLabel = (edge?.data?.label as string) ?? "";
  const [draft, setDraft] = useState(currentLabel);

  useEffect(() => {
    setDraft(currentLabel);
  }, [currentLabel]);

  if (!edge) return null;

  const handleCommit = () => {
    if (draft !== currentLabel) {
      onUpdateLabel(edgeId, draft);
    }
  };

  return (
    <aside className="flex w-72 flex-shrink-0 flex-col border-l border-slate-200 bg-white">
      {/* ヘッダー */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <span className="text-sm font-semibold text-slate-700">Edge</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Close panel"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <section>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Label</p>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleCommit}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCommit();
            }}
            placeholder="エッジラベルを入力..."
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
          />
          <p className="mt-1 text-xs text-slate-400">ラベルをダブルクリックでキャンバス上から編集</p>
        </section>
      </div>

      {/* フッター：削除ボタン */}
      <div className="border-t border-slate-200 p-4">
        <button
          type="button"
          onClick={() => {
            onDeleteEdge(edgeId);
          }}
          className="w-full rounded-lg border border-red-200 py-2 text-sm font-medium text-red-500 hover:bg-red-50"
        >
          Delete Edge
        </button>
      </div>
    </aside>
  );
}

// ── GraphCanvas ────────────────────────────────────────────────────────────────

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
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  // 再配置: 直近に使ったアルゴリズム（メインボタンで再適用）とメニュー開閉
  const [selectedAlgo, setSelectedAlgo] = useState<LayoutAlgorithm>(DEFAULT_LAYOUT_ALGORITHM);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const layoutMenuRef = useRef<HTMLDivElement | null>(null);
  // 再配置後にビューを合わせるため ReactFlow インスタンスを保持
  const rfInstanceRef = useRef<ReturnType<typeof useReactFlow> | null>(null);
  const [mermaidCopied, setMermaidCopied] = useState(false);

  // メニュー外クリックで閉じる
  useEffect(() => {
    if (!layoutMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (layoutMenuRef.current && !layoutMenuRef.current.contains(e.target as Node)) {
        setLayoutMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [layoutMenuOpen]);

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
        {
          id: newNode.id,
          type: "default",
          position: { x: newNode.x, y: newNode.y },
          data: { label: newNode.label, nodeType: newNode.nodeType ?? null, autoEdit: true },
        },
      ]);
    },
  });

  const createEdge = useMutation({
    mutationFn: ({ sourceNodeId, targetNodeId }: { sourceNodeId: string; targetNodeId: string }) =>
      orpc.edge.create({ graphId: graph.id, sourceNodeId, targetNodeId }),
    onSuccess: (newEdge) => {
      setEdges((eds) => [
        ...eds,
        {
          id: newEdge.id,
          source: newEdge.sourceNodeId,
          target: newEdge.targetNodeId,
          type: "editable",
          data: { label: newEdge.label ?? "" },
        },
      ]);
    },
  });

  const updateEdgeLabel = useMutation({
    mutationFn: ({ id, label }: { id: string; label: string }) =>
      orpc.edge.updateLabel({ id, label }),
    onSuccess: (updatedEdge) => {
      setEdges((eds) =>
        eds.map((e) =>
          e.id === updatedEdge.id ? { ...e, data: { ...e.data, label: updatedEdge.label } } : e,
        ),
      );
    },
  });

  const deleteNode = useMutation({
    mutationFn: (id: string) => orpc.node.delete({ id }),
  });

  const deleteEdge = useMutation({
    mutationFn: (id: string) => orpc.edge.delete({ id }),
  });

  const updateNodeType = useMutation({
    mutationFn: ({ id, nodeType }: { id: string; nodeType: string | null }) =>
      orpc.node.updateType({ id, nodeType }),
  });

  const handleUpdateNodeType = useCallback(
    (nodeId: string, nodeType: string | null) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, nodeType } } : n)),
      );
      updateNodeType.mutate({ id: nodeId, nodeType });
    },
    [setNodes, updateNodeType],
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) {
        createEdge.mutate({ sourceNodeId: connection.source, targetNodeId: connection.target });
      }
    },
    [createEdge],
  );

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, node: RFNode) => {
      updatePosition.mutate({ id: node.id, x: node.position.x, y: node.position.y });
    },
    [updatePosition],
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: RFNode) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
  }, []);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: RFEdge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  const onNodesDelete = useCallback(
    (deletedNodes: RFNode[]) => {
      for (const n of deletedNodes) {
        deleteNode.mutate(n.id);
        if (selectedNodeId === n.id) setSelectedNodeId(null);
      }
    },
    [deleteNode, selectedNodeId],
  );

  const onEdgesDelete = useCallback(
    (deletedEdges: RFEdge[]) => {
      for (const e of deletedEdges) {
        deleteEdge.mutate(e.id);
        if (selectedEdgeId === e.id) setSelectedEdgeId(null);
      }
    },
    [deleteEdge, selectedEdgeId],
  );

  const handleDeleteNodeFromPanel = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      deleteNode.mutate(nodeId);
      setSelectedNodeId(null);
    },
    [setNodes, setEdges, deleteNode],
  );

  const handleDeleteEdgeFromPanel = useCallback(
    (edgeId: string) => {
      setEdges((eds) => eds.filter((e) => e.id !== edgeId));
      deleteEdge.mutate(edgeId);
      setSelectedEdgeId(null);
    },
    [setEdges, deleteEdge],
  );

  const handleUpdateEdgeLabel = useCallback(
    (edgeId: string, label: string) => {
      updateEdgeLabel.mutate({ id: edgeId, label });
    },
    [updateEdgeLabel],
  );

  const runLayout = useCallback(
    async (algo: LayoutAlgorithm) => {
      if (nodes.length === 0) return;
      const positions = await computeElkLayout(nodes, edges, algo.elkOptions);
      const updated = nodes.map((n) => {
        const pos = positions.get(n.id);
        return pos ? { ...n, position: pos } : n;
      });
      setNodes(updated);
      for (const n of updated) {
        updatePosition.mutate({ id: n.id, x: n.position.x, y: n.position.y });
      }
      // 新しい配置が画面内に収まるようビューを合わせる
      requestAnimationFrame(() => {
        rfInstanceRef.current?.fitView({ duration: 400, padding: 0.2 });
      });
    },
    [nodes, edges, setNodes, updatePosition],
  );

  const handleCopyMermaid = useCallback(() => {
    const diagram = generateMermaidDiagram(nodes, edges);
    navigator.clipboard.writeText(diagram).then(() => {
      setMermaidCopied(true);
      setTimeout(() => setMermaidCopied(false), 2000);
    });
  }, [nodes, edges]);

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded px-3 py-1 text-sm text-slate-600 hover:bg-slate-100"
        >
          ← Back
        </button>
        <h1 className="font-semibold text-slate-800">{graph.name}</h1>
        {graph.description && <span className="text-sm text-slate-400">{graph.description}</span>}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={handleCopyMermaid}
            className="rounded-lg border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
          >
            {mermaidCopied ? "Copied!" : "Copy as Mermaid"}
          </button>
          {/* 再配置: 分割ボタン（メインで直近アルゴリズムを再適用 / ▼でアルゴリズム選択） */}
          <div ref={layoutMenuRef} className="relative flex">
            <button
              type="button"
              onClick={() => runLayout(selectedAlgo)}
              className="rounded-l-lg border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
            >
              ⤢ 再配置: {selectedAlgo.label}
            </button>
            <button
              type="button"
              aria-label="レイアウトアルゴリズムを選択"
              onClick={() => setLayoutMenuOpen((v) => !v)}
              className="rounded-r-lg border border-l-0 border-slate-300 px-2 py-1 text-sm hover:bg-slate-50"
            >
              ▼
            </button>
            {layoutMenuOpen && (
              <ul className="absolute right-0 top-full z-10 mt-1 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                {LAYOUT_ALGORITHMS.map((algo) => (
                  <li key={algo.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAlgo(algo);
                        setLayoutMenuOpen(false);
                        runLayout(algo);
                      }}
                      className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50 ${
                        algo.id === selectedAlgo.id ? "bg-slate-100 font-medium" : ""
                      }`}
                    >
                      {algo.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            disabled={createNode.isPending}
            onClick={() => {
              createNode.mutate("New Node");
            }}
            className="rounded-lg bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            + Add Node
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            onNodesDelete={onNodesDelete}
            onEdgesDelete={onEdgesDelete}
            deleteKeyCode="Delete"
            fitView
            onInit={(instance) => {
              rfInstanceRef.current = instance;
            }}
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>

        {selectedNodeId && (
          <SidePanel
            nodeId={selectedNodeId}
            nodes={nodes}
            onClose={() => setSelectedNodeId(null)}
            onDeleteNode={handleDeleteNodeFromPanel}
            onUpdateNodeType={handleUpdateNodeType}
          />
        )}
        {selectedEdgeId && (
          <EdgeSidePanel
            edgeId={selectedEdgeId}
            edges={edges}
            onClose={() => setSelectedEdgeId(null)}
            onDeleteEdge={handleDeleteEdgeFromPanel}
            onUpdateLabel={handleUpdateEdgeLabel}
          />
        )}
      </div>
    </div>
  );
}

// ── GraphView ─────────────────────────────────────────────────────────────────

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
      <div className="flex h-dvh items-center justify-center text-slate-400">Loading graph…</div>
    );
  }

  const initialNodes: RFNode[] = (dbNodes ?? []).map((n) => ({
    id: n.id,
    type: "default",
    position: { x: n.x, y: n.y },
    data: { label: n.label, nodeType: n.nodeType ?? null },
  }));
  const initialEdges: RFEdge[] = (dbEdges ?? []).map((e) => ({
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    type: "editable",
    data: { label: e.label ?? "" },
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
  const [editingGraphId, setEditingGraphId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const singleClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    onSuccess: (newGraph) => {
      qc.invalidateQueries({ queryKey: ["graphs"] });
      setEditingDraft(newGraph.name);
      setEditingGraphId(newGraph.id);
      setTimeout(() => nameInputRef.current?.select(), 0);
    },
  });

  const updateGraphName = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      orpc.graph.updateName({ id, name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["graphs"] }),
  });

  const deleteGraph = useMutation({
    mutationFn: (id: string) => orpc.graph.delete({ id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["graphs"] }),
  });

  const commitGraphName = useCallback(() => {
    if (!editingGraphId) return;
    const trimmed = editingDraft.trim();
    const current = graphs.find((g) => g.id === editingGraphId)?.name ?? "";
    if (trimmed && trimmed !== current) {
      updateGraphName.mutate({ id: editingGraphId, name: trimmed });
    }
    setEditingGraphId(null);
  }, [editingGraphId, editingDraft, graphs, updateGraphName]);

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
            createGraph.mutate("New Graph");
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
              <div className="flex-1 text-left min-w-0">
                {editingGraphId === g.id ? (
                  <input
                    ref={nameInputRef}
                    value={editingDraft}
                    onChange={(e) => setEditingDraft(e.target.value)}
                    onBlur={commitGraphName}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitGraphName();
                      if (e.key === "Escape") setEditingGraphId(null);
                    }}
                    className="w-full rounded border border-blue-400 px-1 py-0 text-base font-medium text-blue-600 outline-none focus:ring-1 focus:ring-blue-400"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (singleClickTimer.current) clearTimeout(singleClickTimer.current);
                      singleClickTimer.current = setTimeout(() => onSelect(g), 250);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (singleClickTimer.current) {
                        clearTimeout(singleClickTimer.current);
                        singleClickTimer.current = null;
                      }
                      setEditingDraft(g.name);
                      setEditingGraphId(g.id);
                      setTimeout(() => nameInputRef.current?.select(), 0);
                    }}
                    className="text-left"
                  >
                    <div className="font-medium text-blue-600 hover:underline">{g.name}</div>
                  </button>
                )}
                {g.description && (
                  <div className="mt-1 text-sm text-slate-500">{g.description}</div>
                )}
                <div className="mt-2 font-mono text-xs text-slate-400">{g.createdAt}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  deleteGraph.mutate(g.id);
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
