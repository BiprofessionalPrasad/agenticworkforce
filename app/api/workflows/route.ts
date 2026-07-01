import type { NextRequest } from "next/server";
import { getAllWorkflows, saveWorkflow, createWorkflow } from "../../../lib/storage";
import { getCurrentUser } from "../../../lib/session";
import type { Workflow } from "../../../lib/types";
import { ensureScheduler, registerSchedule, unregisterSchedule } from "../../../lib/scheduler";

// GET /api/workflows - list current user's only
export async function GET() {
  try {
    await ensureScheduler();
    const user = await getCurrentUser();
    if (!user) {
      return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const workflows = await getAllWorkflows(user.id);
    return Response.json({ success: true, data: { workflows } });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Failed to load workflows" }, { status: 500 });
  }
}

// POST /api/workflows - create new (scoped to user)
export async function POST(request: NextRequest) {
  try {
    await ensureScheduler();
    const user = await getCurrentUser();
    if (!user) {
      return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const name = body.name || "Untitled Workflow";
    const nodes = Array.isArray(body.nodes) ? body.nodes : [];
    const edges = Array.isArray(body.edges) ? body.edges : [];
    const active = body.active ?? false;

    const created = await createWorkflow(name, nodes, edges, user.id, active);
    registerSchedule(created);
    return Response.json({ success: true, data: created }, { status: 201 });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Failed to create workflow" }, { status: 500 });
  }
}
