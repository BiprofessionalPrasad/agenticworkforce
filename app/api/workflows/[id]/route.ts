import type { NextRequest } from "next/server";
import { getWorkflow, saveWorkflow, deleteWorkflow } from "../../../../lib/storage";
import type { Workflow } from "../../../../lib/types";

// GET /api/workflows/[id]
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const wf = await getWorkflow(id);
    if (!wf) {
      return Response.json({ success: false, error: "Workflow not found" }, { status: 404 });
    }
    return Response.json({ success: true, data: wf });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Failed to load workflow" }, { status: 500 });
  }
}

// PUT /api/workflows/[id] - update full workflow
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const existing = await getWorkflow(id);
    if (!existing) {
      return Response.json({ success: false, error: "Workflow not found" }, { status: 404 });
    }

    const updated: Workflow = {
      ...existing,
      ...body,
      id, // force id
      nodes: Array.isArray(body.nodes) ? body.nodes : existing.nodes,
      edges: Array.isArray(body.edges) ? body.edges : existing.edges,
      name: body.name || existing.name,
    };

    const saved = await saveWorkflow(updated);
    return Response.json({ success: true, data: saved });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Failed to update workflow" }, { status: 500 });
  }
}

// DELETE /api/workflows/[id]
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ok = await deleteWorkflow(id);
    if (!ok) {
      return Response.json({ success: false, error: "Workflow not found" }, { status: 404 });
    }
    return Response.json({ success: true });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Failed to delete workflow" }, { status: 500 });
  }
}
