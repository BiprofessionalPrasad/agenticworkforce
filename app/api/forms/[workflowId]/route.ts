import type { NextRequest } from "next/server";
import { getWorkflow, saveExecution, getAllCredentials } from "../../../../lib/storage";
import { executeWorkflow } from "../../../../lib/execution";
import type { Workflow, Credential } from "../../../../lib/types";
import { ensureScheduler } from "../../../../lib/scheduler";
import { decryptCredentialData } from "../../../../lib/credentials";

// POST /api/forms/[workflowId]
// Form trigger: accepts application/x-www-form-urlencoded or JSON body.
// Rich context is passed to formTrigger node.
// Optional: if formTrigger node has `secret`, requires X-Form-Secret header match.
export async function POST(request: NextRequest, { params }: { params: Promise<{ workflowId: string }> }) {
  try {
    await ensureScheduler();
    const { workflowId } = await params;
    const wf = await getWorkflow(workflowId);
    if (!wf) {
      return Response.json({ success: false, error: "Workflow not found" }, { status: 404 });
    }
    if (!wf.active) {
      return Response.json({ success: false, error: "Workflow is not active. Activate it to accept form triggers." }, { status: 403 });
    }

    // Parse body: support form or json
    let body: any = {};
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await request.formData();
      body = Object.fromEntries(form.entries());
    } else {
      body = await request.json().catch(() => ({}));
    }

    const formTriggerNode = wf.nodes.find((n) => n.type === "formTrigger");
    if (formTriggerNode) {
      const p = formTriggerNode.data?.parameters || {};
      let secret = p.secret || p.authToken;
      const cid = p.credentialId || p.credential;
      if (cid && !secret) {
        try {
          const serverCredsForAuth = await getAllCredentials((wf as any).userId);
          const c = serverCredsForAuth.find((cc: any) => cc.id === cid);
          if (c) {
            const data = decryptCredentialData((c as any).encryptedData || "");
            secret = data.apiKey || data.secret || data.token || data.password || data.accessToken;
          }
        } catch {}
      }
      if (secret) {
        const provided = request.headers.get("x-form-secret") || request.headers.get("x-webhook-secret") || (body as any).secret || (body as any).token;
        if (String(provided || "") !== String(secret)) {
          return Response.json({ success: false, error: "Unauthorized form submission (bad secret/credential)" }, { status: 401 });
        }
      }
    }

    // Rich context for formTrigger
    const richForm = {
      form: true,
      submittedAt: new Date().toISOString(),
      data: body,
      headers: Object.fromEntries(request.headers.entries()),
      method: request.method,
      query: Object.fromEntries(request.nextUrl.searchParams.entries()),
      source: "form",
    };

    // Inject into formTrigger (and webhook/manual for flexibility)
    const nodes = wf.nodes.map((n) => {
      if (n.type === "formTrigger" || n.type === "webhookTrigger" || n.type === "manualTrigger") {
        return {
          ...n,
          data: {
            ...n.data,
            parameters: {
              ...(n.data.parameters || {}),
              formData: richForm,
              testPayload: richForm, // also support test
              payload: richForm,
            },
          },
        };
      }
      return n;
    });
    const workflowToRun: Workflow = { ...wf, nodes };

    // Pre-resolve server credentials + env (same as webhook) so aiLlm/email/telegram/slack/http use real keys in form-triggered runs
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

    await saveExecution({
      workflowId: wf.id,
      workflowName: wf.name,
      userId: wf.userId,
      ...result,
      // Include full snapshot so server-triggered execs (forms) are replayable in History
      workflowSnapshot: { name: wf.name, nodes: wf.nodes || [], edges: wf.edges || [] } as any,
    }, wf.userId);

    return Response.json({
      success: true,
      data: {
        execution: result,
        workflowId: wf.id,
        workflowName: wf.name,
        received: body,
      },
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Form trigger execution failed" }, { status: 500 });
  }
}

// GET: info or simple status (no auth)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ workflowId: string }> }) {
  await ensureScheduler();
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
      active: !!wf.active,
      hasFormTrigger: wf.nodes.some((n) => n.type === "formTrigger"),
    },
  });
}
