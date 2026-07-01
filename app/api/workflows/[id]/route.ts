import type { NextRequest } from "next/server";
import { getWorkflow, saveWorkflow, deleteWorkflow } from "../../../../lib/storage";
import { getCurrentUser } from "../../../../lib/session";
import type { Workflow } from "../../../../lib/types";
import { ensureScheduler, registerSchedule, unregisterSchedule } from "../../../../lib/scheduler";

// GET /api/workflows/[id]
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureScheduler();
    const user = await getCurrentUser();
    if (!user) {
      return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const wf = await getWorkflow(id, user.id);
    if (!wf) {
      return Response.json({ success: false, error: "Workflow not found" }, { status: 404 });
    }
    return Response.json({ success: true, data: wf });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Failed to load workflow" }, { status: 500 });
  }
}

// PUT /api/workflows/[id] - update full workflow (activation changes trigger (re)register)
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureScheduler();
    const user = await getCurrentUser();
    if (!user) {
      return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const body = await request.json();
    const existing = await getWorkflow(id, user.id);
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
      active: body.active !== undefined ? !!body.active : existing.active,
    };

    const saved = await saveWorkflow(updated, user.id);

    // Activation model: (re)register or unregister schedules/triggers based on active
    if (saved.active) {
      registerSchedule(saved);
    } else {
      unregisterSchedule(saved.id);
    }

    return Response.json({ success: true, data: saved });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Failed to update workflow" }, { status: 500 });
  }
}

// DELETE /api/workflows/[id]
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const existing = await getWorkflow(id, user.id);
    if (!existing) {
      return Response.json({ success: false, error: "Workflow not found" }, { status: 404 });
    }
    const { unregisterSchedule } = await import("../../../../lib/scheduler");
    unregisterSchedule(id);
    const ok = await deleteWorkflow(id);
    if (!ok) {
      return Response.json({ success: false, error: "Workflow not found" }, { status: 404 });
    }
    return Response.json({ success: true });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Failed to delete workflow" }, { status: 500 });
  }
}
