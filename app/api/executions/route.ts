import type { NextRequest } from "next/server";
import { getAllExecutions, saveExecution } from "../../../lib/storage";
import { getCurrentUser } from "../../../lib/session";
import type { StoredExecution, ExecutionResult } from "../../../lib/types";
import { ensureScheduler } from "../../../lib/scheduler";

// GET /api/executions?workflowId=xxx  (list, optionally filtered) - user scoped
export async function GET(request: NextRequest) {
  try {
    await ensureScheduler();
    const user = await getCurrentUser();
    if (!user) {
      return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = request.nextUrl;
    const workflowId = searchParams.get("workflowId") || undefined;
    const executions = await getAllExecutions(workflowId, user.id);
    return Response.json({ success: true, data: { executions } });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Failed to load executions" }, { status: 500 });
  }
}

// POST /api/executions - store an execution history record (user scoped)
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();
    if (!body || !body.workflowId || !body.startedAt) {
      return Response.json({ success: false, error: "workflowId and startedAt required" }, { status: 400 });
    }

    // Accept full execution result shape + workflowId
    const execInput = {
      workflowId: body.workflowId,
      workflowName: body.workflowName,
      success: !!body.success,
      results: Array.isArray(body.results) ? body.results : [],
      finalOutput: body.finalOutput,
      error: body.error,
      startedAt: body.startedAt,
      finishedAt: body.finishedAt,
      // Persist snapshot for server + webhook + schedule runs to enable replay/re-run from History (fixes integration gap)
      workflowSnapshot: body.workflowSnapshot || undefined,
    };

    const saved = await saveExecution(execInput as any, user.id);
    return Response.json({ success: true, data: saved }, { status: 201 });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Failed to save execution" }, { status: 500 });
  }
}
