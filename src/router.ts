import { os } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";

// ── Graph ──────────────────────────────────────────────────────────────────────

const graphList = os.handler(async () => {
  const db = getDb();
  return db.select().from(schema.graphs).orderBy(schema.graphs.createdAt).all();
});

const graphCreate = os
  .input(
    z.object({
      name: z.string().min(1, "Name is required"),
      description: z.string().default(""),
    }),
  )
  .handler(async ({ input }) => {
    const db = getDb();
    const id = crypto.randomUUID();
    db.insert(schema.graphs).values({ id, ...input }).run();
    const graph = db.select().from(schema.graphs).where(eq(schema.graphs.id, id)).get();
    if (!graph) throw new Error("Failed to create graph");
    return graph;
  });

const graphGet = os
  .input(z.object({ id: z.string() }))
  .handler(async ({ input }) => {
    const db = getDb();
    const graph = db.select().from(schema.graphs).where(eq(schema.graphs.id, input.id)).get();
    if (!graph) throw new Error(`Graph not found: ${input.id}`);
    return graph;
  });

const graphDelete = os
  .input(z.object({ id: z.string() }))
  .handler(async ({ input }) => {
    const db = getDb();
    db.delete(schema.graphs).where(eq(schema.graphs.id, input.id)).run();
    return { success: true };
  });

// ── Node ───────────────────────────────────────────────────────────────────────

const nodeList = os
  .input(z.object({ graphId: z.string() }))
  .handler(async ({ input }) => {
    const db = getDb();
    return db.select().from(schema.nodes).where(eq(schema.nodes.graphId, input.graphId)).all();
  });

const nodeCreate = os
  .input(
    z.object({
      graphId: z.string(),
      label: z.string().min(1),
      x: z.number().default(0),
      y: z.number().default(0),
    }),
  )
  .handler(async ({ input }) => {
    const db = getDb();
    const id = crypto.randomUUID();
    db.insert(schema.nodes).values({ id, ...input }).run();
    const node = db.select().from(schema.nodes).where(eq(schema.nodes.id, id)).get();
    if (!node) throw new Error("Failed to create node");
    return node;
  });

// ── Edge ───────────────────────────────────────────────────────────────────────

const edgeList = os
  .input(z.object({ graphId: z.string() }))
  .handler(async ({ input }) => {
    const db = getDb();
    return db.select().from(schema.edges).where(eq(schema.edges.graphId, input.graphId)).all();
  });

const edgeCreate = os
  .input(
    z.object({
      graphId: z.string(),
      sourceNodeId: z.string(),
      targetNodeId: z.string(),
      label: z.string().default(""),
    }),
  )
  .handler(async ({ input }) => {
    const db = getDb();
    const id = crypto.randomUUID();
    db.insert(schema.edges).values({ id, ...input }).run();
    const edge = db.select().from(schema.edges).where(eq(schema.edges.id, id)).get();
    if (!edge) throw new Error("Failed to create edge");
    return edge;
  });

// ── Router ─────────────────────────────────────────────────────────────────────

export const router = {
  graph: {
    list: graphList,
    create: graphCreate,
    get: graphGet,
    delete: graphDelete,
  },
  node: {
    list: nodeList,
    create: nodeCreate,
  },
  edge: {
    list: edgeList,
    create: edgeCreate,
  },
};

export type Router = typeof router;
