import type { NextRequest } from "next/server";
import { getWorkflow, saveExecution } from "../../../../lib/storage";
import { executeWorkflow } from "../../../../lib/execution";
import type { Workflow } from "../../../../lib/types";

// POST /api/webhooks/[workflowId]
// Triggers execution of the workflow (server-side) and stores the result.
// Body may contain { input?: any } to override seed for trigger nodes.
export async function POST(request: NextRequest, { params }: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await params;
    const wf = await getWorkflow(workflowId);
    if (!wf) {
      return Response.json({ success: false, error: "Workflow not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const triggerInput = body.input || body.seedData || undefined;

    // Optionally inject seed into starter triggers (manual, webhook, schedule) if provided in body.input
    let workflowToRun: Workflow = wf;
    if (triggerInput) {
      const nodes = wf.nodes.map((n) => {
        if (n.type === "manualTrigger") {
          return {
            ...n,
            data: {
              ...n.data,
              parameters: {
                ...(n.data.parameters || {}),
                seedData: triggerInput,
              },
            },
          };
        }
        if (n.type === "webhookTrigger") {
          return {
            ...n,
            data: {
              ...n.data,
              parameters: {
                ...(n.data.parameters || {}),
                testPayload: triggerInput,
              },
            },
          };
        }
        if (n.type === "scheduleTrigger") {
          return {
            ...n,
            data: {
              ...n.data,
              parameters: {
                ...(n.data.parameters || {}),
                // for schedule, put under payload or description; engine falls back to params
                payload: triggerInput,
              },
            },
          };
        }
        return n;
      });
      workflowToRun = { ...wf, nodes };
    }

    // Execute server side
    const result = await executeWorkflow(workflowToRun);

    // Persist execution
    await saveExecution({
      workflowId: wf.id,
      workflowName: wf.name,
      ...result,
    });

    return Response.json({
      success: true,
      data: {
        execution: result,
        workflowId: wf.id,
        workflowName: wf.name,
      },
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Webhook execution failed" }, { status: 500 });
  }
}

// Optional: GET to check workflow exists or info
export async function GET(_req: NextRequest, { params }: { params: Promise<{ workflowId: string }> }) {
  const { workflowId } = await params;
  const wf = await getWorkflow(workflowId);
  if (!wf) {
    return Response.json({ success: false, error: "Workflow not found" }, { status: 404 });
  }
  return Response.json({ success: true, data: { id: wf.id, name: wf.name, nodeCount: wf.nodes.length } });
}
