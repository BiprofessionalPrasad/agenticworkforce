import type { NextRequest } from "next/server";
import { getWorkflow, saveExecution, getAllCredentials } from "../../../../lib/storage";
import { executeWorkflow } from "../../../../lib/execution";
import type { Workflow, Credential } from "../../../../lib/types";
import { ensureScheduler } from "../../../../lib/scheduler";
import { decryptCredentialData } from "../../../../lib/credentials";

// POST /api/webhooks/[workflowId]
// Enhanced production-grade webhook trigger:
// - Requires workflow.active === true (publishing/activation model)
// - Supports optional auth via webhookTrigger node params `secret` (matches X-Webhook-Secret / Authorization / body.secret)
// - Richer context ALWAYS provided: full {body, headers, query, method, url, timestamp, source, ...}
// - Body can still provide override input
// - Server-side real execution + persist (reliable for triggers)
export async function POST(request: NextRequest, { params }: { params: Promise<{ workflowId: string }> }) {
  try {
    await ensureScheduler();

    const { workflowId } = await params;
    const wf = await getWorkflow(workflowId);
    if (!wf) {
      return Response.json({ success: false, error: "Workflow not found" }, { status: 404 });
    }
    if (wf.active === false) {
      return Response.json({ success: false, error: "Workflow is not active. Activate the workflow to accept webhooks." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const overrideInput = body.input || body.seedData || body.payload || undefined;

    // Auth check for webhookTrigger (enhanced: supports secret on node OR via credentialId for production auth)
    const webhookNode = wf.nodes.find((n) => n.type === "webhookTrigger");
    let effectiveSecret: string | undefined;
    if (webhookNode) {
      const p = webhookNode.data?.parameters || {};
      effectiveSecret = p.secret || p.authToken || p.webhookSecret;
      const cid = p.credentialId || p.credential;
      if (cid && !effectiveSecret) {
        try {
          const serverCredsForAuth = await getAllCredentials((wf as any).userId);
          const c = serverCredsForAuth.find((cc: any) => cc.id === cid);
          if (c) {
            const data = decryptCredentialData((c as any).encryptedData || "");
            effectiveSecret = data.apiKey || data.secret || data.token || data.password || data.accessToken;
          }
        } catch {}
      }
      if (effectiveSecret) {
        const provided = request.headers.get("x-webhook-secret") ||
                         request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
                         (body as any).secret || (body as any).token;
        if (String(provided || "") !== String(effectiveSecret)) {
          return Response.json({ success: false, error: "Unauthorized (webhook secret/credential mismatch)" }, { status: 401 });
        }
      }
    }

    // Build richer context for trigger nodes (always, not just override)
    const richContext: any = {
      body,
      headers: Object.fromEntries(request.headers.entries()),
      query: Object.fromEntries(request.nextUrl.searchParams.entries()),
      method: request.method,
      url: request.url,
      timestamp: new Date().toISOString(),
      source: "webhook",
    };
    if (overrideInput && typeof overrideInput === "object") {
      Object.assign(richContext, overrideInput);
    } else if (overrideInput != null) {
      richContext.input = overrideInput;
    }

    // Inject rich data into starter triggers (webhook + others for convenience)
    const nodes = wf.nodes.map((n) => {
      if (n.type === "manualTrigger") {
        return {
          ...n,
          data: {
            ...n.data,
            parameters: {
              ...(n.data.parameters || {}),
              seedData: richContext,
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
              testPayload: richContext,
              webhook: richContext,
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
              payload: richContext,
            },
          },
        };
      }
      if (n.type === "formTrigger") {
        return {
          ...n,
          data: {
            ...n.data,
            parameters: {
              ...(n.data.parameters || {}),
              formData: richContext,
            },
          },
        };
      }
      return n;
    });
    const workflowToRun: Workflow = { ...wf, nodes };

    // Pre-resolve server credentials into params for secure real integrations (aiLlm, email, http etc)
    // This lets server runs use stored creds without exposing to client
    const serverCreds = await getAllCredentials((wf as any).userId);
    const resolvedNodes = workflowToRun.nodes.map((n) => {
      const p = { ...(n.data.parameters || {}) };
      const cid = p.credentialId || p.credential;
      if (cid) {
        const c = serverCreds.find((cc) => cc.id === cid);
        if (c) {
          try {
            const data = decryptCredentialData((c as any).encryptedData || "");
            if (data.apiKey) p.apiKey = data.apiKey;
            if (data.accessToken) p.apiKey = data.accessToken;
            if (data.username) p.username = data.username;
            if (data.password) p.password = data.password;
            if (data.resendApiKey) p.resendApiKey = data.resendApiKey;
            if (data.botToken) p.botToken = data.botToken;
            if (data.smtpHost) p.smtpHost = data.smtpHost;
            if (data.smtpPort) p.smtpPort = data.smtpPort;
            if (data.smtpUser) p.smtpUser = data.smtpUser;
            if (data.smtpPass) p.smtpPass = data.smtpPass;
            if (data.values && typeof data.values === "object") Object.assign(p, data.values);
          } catch {}
        }
      }
      // Also allow direct env injection for common on server (if not in cred)
      if (!p.apiKey && process.env.OPENAI_API_KEY) p.apiKey = process.env.OPENAI_API_KEY;
      if (!p.resendApiKey && process.env.RESEND_API_KEY) p.resendApiKey = process.env.RESEND_API_KEY;
      if (!p.botToken && process.env.TELEGRAM_BOT_TOKEN) p.botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!p.smtpHost && process.env.SMTP_HOST) p.smtpHost = process.env.SMTP_HOST;
      if (!p.smtpUser && process.env.SMTP_USER) p.smtpUser = process.env.SMTP_USER;
      if (!p.smtpPass && process.env.SMTP_PASS) p.smtpPass = process.env.SMTP_PASS;
      return { ...n, data: { ...n.data, parameters: p } };
    });
    const finalWorkflowToRun: Workflow = { ...workflowToRun, nodes: resolvedNodes };

    const result = await executeWorkflow(finalWorkflowToRun, serverCreds, (wf as any).userId);

    // Persist execution
    await saveExecution({
      workflowId: wf.id,
      workflowName: wf.name,
      userId: wf.userId,
      ...result,
      // Include full snapshot so server-triggered execs (webhook) are replayable in History
      workflowSnapshot: { name: wf.name, nodes: wf.nodes || [], edges: wf.edges || [] } as any,
    }, wf.userId);

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

// Optional: GET to check workflow exists or info (enhanced with active + trigger presence)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ workflowId: string }> }) {
  const { workflowId } = await params;
  const wf = await getWorkflow(workflowId);
  if (!wf) {
    return Response.json({ success: false, error: "Workflow not found" }, { status: 404 });
  }
  return Response.json({
    success: true,
    data: {
      id: wf.id,
      name: wf.name,
      nodeCount: wf.nodes.length,
      active: !!wf.active,
      hasWebhookTrigger: wf.nodes.some((n) => n.type === "webhookTrigger"),
      hasScheduleTrigger: wf.nodes.some((n) => n.type === "scheduleTrigger"),
      hasFormTrigger: wf.nodes.some((n) => n.type === "formTrigger"),
    },
  });
}
