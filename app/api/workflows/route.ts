import type { NextRequest } from "next/server";
import { getAllWorkflows, saveWorkflow, createWorkflow } from "../../../lib/storage";
import type { Workflow } from "../../../lib/types";

// GET /api/workflows - list all
export async function GET() {
  try {
    const workflows = await getAllWorkflows();
    return Response.json({ success: true, data: { workflows } });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Failed to load workflows" }, { status: 500 });
  }
}

// POST /api/workflows - create new
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const name = body.name || "Untitled Workflow";
    const nodes = Array.isArray(body.nodes) ? body.nodes : [];
    const edges = Array.isArray(body.edges) ? body.edges : [];

    const created = await createWorkflow(name, nodes, edges);
    return Response.json({ success: true, data: created }, { status: 201 });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Failed to create workflow" }, { status: 500 });
  }
}
