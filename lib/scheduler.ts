import { getActiveWorkflows, getWorkflow, saveExecution, getAllCredentials } from "./storage";
import { executeWorkflow } from "./execution";
import { decryptCredentialData } from "./credentials";
import type { Workflow, Credential } from "./types";

/**
 * Production-grade (demo) server-side scheduler for n8nlike. (High Priority #4)
 * - Uses native setInterval + full 5-field cron matcher (no external deps; node-cron optional for prod)
 * - Only schedules workflows with active=true and a scheduleTrigger node.
 * - Persists via storage; in-memory jobs re-registered on demand / on API loads.
 * - On fire: uses real server executeWorkflow + saveExecution (reliable in API mode).
 * - Registers on API route loads via ensureScheduler; auto (un)register on activate/save.
 * - Supports star/n , ranges, lists for min/hour/dom/mon/dow.
 *
 * Note: Timers live in server process (restarted on deploy/hot-reload in dev).
 * For prod scale use BullMQ/Inngest + durable storage of last-run times.
 */

type Job = {
  workflowId: string;
  cron: string;
  lastRun?: string;
};

const jobs = new Map<string, Job>();
let ticker: NodeJS.Timeout | null = null;
let initialized = false;

function parseField(field: string, value: number, max: number): boolean {
  if (!field) return true;
  if (field === "*" || field === "?") return true;
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    if (!step || step <= 0) return false;
    return value % step === 0;
  }
  const parts = field.split(",");
  for (const p of parts) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    if (trimmed === "*" || trimmed === "?") return true;
    if (trimmed.startsWith("*/")) {
      const step = parseInt(trimmed.slice(2), 10);
      if (step > 0 && value % step === 0) return true;
      continue;
    }
    if (trimmed.includes("-")) {
      const [lo, hi] = trimmed.split("-").map((n) => parseInt(n, 10));
      if (!isNaN(lo) && !isNaN(hi) && value >= lo && value <= hi) return true;
    } else if (parseInt(trimmed, 10) === value) {
      return true;
    }
  }
  return false;
}

/** Production-grade (demo) 5-field cron matcher: min hour dom mon dow.
 * Supports *, star/n, ranges a-b, lists a,b,c . ? treated as *.
 * Used for scheduleTrigger real server firing (active workflows only).
 */
export function matchesCron(cron: string, date: Date = new Date()): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return false;
  const [minStr, hourStr, domStr = "*", monStr = "*", dowStr = "*"] = parts;

  const m = date.getMinutes();
  const h = date.getHours();
  const dom = date.getDate(); // 1-31
  const mon = date.getMonth() + 1; // 1-12
  const dow = date.getDay(); // 0=Sun ... 6=Sat

  const minOk = parseField(minStr, m, 59);
  const hourOk = parseField(hourStr, h, 23);
  const domOk = parseField(domStr, dom, 31);
  const monOk = parseField(monStr, mon, 12);
  const dowOk = parseField(dowStr, dow, 6);

  return minOk && hourOk && domOk && monOk && dowOk;
}

function getScheduleFromWorkflow(wf: Workflow): string | null {
  const node = wf.nodes.find((n) => n.type === "scheduleTrigger");
  if (!node) return null;
  const p = node.data?.parameters || {};
  return p.schedule || p.cron || "*/5 * * * *";
}

async function fireSchedule(workflowId: string, cron: string) {
  try {
    const wf = await getWorkflow(workflowId);
    if (!wf || !wf.active) {
      unregisterSchedule(workflowId);
      return;
    }
    const schedNode = wf.nodes.find((n) => n.type === "scheduleTrigger");
    if (!schedNode) return;

    // Prepare a fresh workflow copy with rich real schedule payload (no simulated flag)
    const nodes = wf.nodes.map((n) => {
      if (n.type === "scheduleTrigger") {
        return {
          ...n,
          data: {
            ...n.data,
            parameters: {
              ...(n.data.parameters || {}),
              payload: {
                scheduled: true,
                schedule: cron,
                triggeredAt: new Date().toISOString(),
                real: true,
                source: "server-cron",
              },
            },
          },
        };
      }
      return n;
    });
    const toRun: Workflow = { ...wf, nodes };

    // Pre-resolve server credentials (user scoped) + env for real integrations (consistent with webhook)
    const serverCreds = await getAllCredentials(wf.userId).catch(() => []);
    const resolvedNodes = toRun.nodes.map((n) => {
      const p = { ...(n.data.parameters || {}) };
      const cid = p.credentialId || p.credential;
      if (cid) {
        const c = serverCreds.find((cc: any) => cc && cc.id === String(cid));
        if (c) {
          try {
            const data = decryptCredentialData((c as any).encryptedData || "");
            if (data.apiKey) p.apiKey = data.apiKey;
            if (data.accessToken) p.apiKey = data.accessToken;
            if (data.username) p.username = data.username;
            if (data.password) p.password = data.password;
            if (data.resendApiKey) p.resendApiKey = data.resendApiKey;
            if (data.botToken) p.botToken = data.botToken;
            if (data.token) p.apiKey = data.token;
            if (data.smtpHost) p.smtpHost = data.smtpHost;
            if (data.smtpPort) p.smtpPort = data.smtpPort;
            if (data.smtpUser) p.smtpUser = data.smtpUser;
            if (data.smtpPass) p.smtpPass = data.smtpPass;
            if (data.values) {
              const vv = typeof data.values === "string" ? (() => { try { return JSON.parse(data.values); } catch { return {}; } })() : data.values;
              if (vv && typeof vv === "object") Object.assign(p, vv);
            }
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
    const finalToRun: Workflow = { ...toRun, nodes: resolvedNodes };

    const result = await executeWorkflow(finalToRun, serverCreds, wf.userId);
    await saveExecution({
      workflowId: wf.id,
      workflowName: wf.name,
      userId: wf.userId,
      ...result,
      // Include full snapshot so scheduled server-triggered execs are replayable in History (was thin before)
      workflowSnapshot: { name: wf.name, nodes: wf.nodes || [], edges: wf.edges || [] },
    }, wf.userId);

    // update last run on job
    const job = jobs.get(workflowId);
    if (job) job.lastRun = new Date().toISOString();

    console.log(`[scheduler] Fired schedule for ${wf.name} (${workflowId}) success=${result.success}`);
  } catch (err: any) {
    console.error(`[scheduler] Fire error for ${workflowId}:`, err?.message || err);
  }
}

async function checkDueSchedules() {
  const now = new Date();
  for (const [wfId, job] of jobs.entries()) {
    if (matchesCron(job.cron, now)) {
      // Basic debounce: don't re-fire within same minute
      if (job.lastRun) {
        const last = new Date(job.lastRun);
        if (last.getMinutes() === now.getMinutes() && last.getHours() === now.getHours()) {
          continue;
        }
      }
      await fireSchedule(wfId, job.cron);
    }
  }
}

export function registerSchedule(workflow: Workflow) {
  if (!workflow.active) {
    unregisterSchedule(workflow.id);
    return;
  }
  const cron = getScheduleFromWorkflow(workflow);
  if (!cron) {
    unregisterSchedule(workflow.id);
    return;
  }
  jobs.set(workflow.id, {
    workflowId: workflow.id,
    cron,
    lastRun: jobs.get(workflow.id)?.lastRun,
  });
  console.log(`[scheduler] Registered schedule ${cron} for active wf ${workflow.id}`);
}

export function unregisterSchedule(workflowId: string) {
  if (jobs.delete(workflowId)) {
    console.log(`[scheduler] Unregistered ${workflowId}`);
  }
}

export async function initScheduler() {
  if (initialized) return;
  initialized = true;

  try {
    const actives = await getActiveWorkflows();
    for (const wf of actives) {
      registerSchedule(wf);
    }
  } catch (e) {
    console.warn("[scheduler] init load failed", e);
  }

  if (!ticker) {
    // Check frequently for responsiveness in demo (15s granularity for cron like */1 or */2)
    ticker = setInterval(() => {
      checkDueSchedules().catch(() => {});
    }, 15_000);
    // Also run an immediate check on start
    setTimeout(() => checkDueSchedules().catch(() => {}), 1500);
    console.log("[scheduler] Ticker started (real server-side cron scheduling active via setInterval + full 5-field matcher)");
  }
}

export function listScheduledJobs() {
  return Array.from(jobs.values());
}

// Allow forcing a schedule fire (for manual demo / tests)
export async function forceFireSchedule(workflowId: string): Promise<boolean> {
  const job = jobs.get(workflowId);
  const cron = job?.cron || (await (async () => {
    const wf = await getWorkflow(workflowId);
    return wf ? getScheduleFromWorkflow(wf) : null;
  })());
  if (!cron) return false;
  await fireSchedule(workflowId, cron);
  return true;
}

// Bootstrap hook: call on server routes
export async function ensureScheduler() {
  if (!initialized) {
    await initScheduler();
  }
  // re-register any newly activated
  try {
    const actives = await getActiveWorkflows();
    for (const wf of actives) registerSchedule(wf);
  } catch {}
}
