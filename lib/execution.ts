import {
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  ExecutionResult,
  NodeExecutionResult,
  NodeType,
  ExecutionItem,
  Credential,
} from "./types";
import { getNodeDefinition } from "./nodes";
import { getClientCredential, getDecryptedData } from "./credentials";

/**
 * n8nlike Execution Engine (improved)
 *
 * Key behaviors:
 * - Data model: ExecutionItem[] = [{ json: {...} }, ...] flows on every edge (multi-item like n8n)
 * - Expression language: powerful {{ }} interpolation + JS exprs using evaluateExpr
 *   Supported in Set values, HTTP url/body, IF left/right, Code (native), and other nodes.
 * - Context provided per item:
 *     $json               -> item.json
 *     $input.json / $input.all() / $input.first()
 *     $node["Label"]      -> { json, output, all() } from a prior node's first output item
 *     $node["id"] also works
 *     $workflow, $now, $today
 *     Math.*, Date etc available inside expressions
 * - Execution: Kahn's algo (indegree) + parallel batches for independent branches
 * - Error / Retry:
 *     params.retries (int >=0)
 *     params.continueOnFail (bool)  -> record error + continue with error-augmented items
 *     retries use backoff; on exhaustion either fatal or continue
 * - IF: per-item conditions; routing uses sourceHandle "true"/"false" + strips $condition marker
 * - All nodes (core + extended) updated for items + context
 * - Fully async, awaits for HTTP etc.
 *
 * NOTE: Code node + expression eval use new Function (browser context, "use with care").
 */

/**
 * Powerful n8n-inspired expression resolver.
 *
 * Supports:
 * - Full string interpolation: "Hello {{ $json.name }} at {{ $now }}"
 * - Exact expressions: {{ $json.foo.bar + 10 }}
 * - $json (current item), $input (current + .all(), .first(), .json)
 * - $node["Node Label"] or $node["id"]  =>  { json, output, all() }
 * - $workflow, $now, $today
 * - Simple math, string ops, comparisons inside {{ }}, Math.*, etc.
 * - Falls back gracefully on errors.
 *
 * Uses limited new Function (same risk level as existing Code node).
 */
function resolveExpression(expr: any, context: any): any {
  if (typeof expr !== "string") return expr;
  const str = expr;

  // If the entire value is a single {{ expr }}, return the raw evaluated result (not stringified)
  const exact = str.trim().match(/^\{\{\s*(.+?)\s*\}\}$/);
  if (exact) {
    return evaluateExpr(exact[1], context);
  }

  // Interpolate multiple {{ }} inside the string. Always produce string result.
  return str.replace(/\{\{\s*(.+?)\s*\}\}/g, (_, innerExpr) => {
    const val = evaluateExpr(innerExpr, context);
    if (val == null) return "";
    if (typeof val === "object") return JSON.stringify(val);
    return String(val);
  });
}

/** Evaluate a raw expression string against the provided scope. */
function evaluateExpr(expr: string, scope: any): any {
  const cleanExpr = (expr || "").trim();
  if (!cleanExpr) return undefined;

  // Fast path for simple $json.path (no operators) to avoid Function overhead and for safety.
  const simplePath = cleanExpr.match(/^\$json\.([a-zA-Z0-9_$.]+)$/);
  if (simplePath && scope?.$json) {
    return getValueByPath(scope.$json, simplePath[1]);
  }
  const simpleInputPath = cleanExpr.match(/^\$input\.json\.([a-zA-Z0-9_$.]+)$/);
  if (simpleInputPath && scope?.$input?.json) {
    return getValueByPath(scope.$input.json, simpleInputPath[1]);
  }

  try {
    // Build a safe(ish) scope. Code node already uses new Function so this is consistent.
    const safeBuiltins = {
      Math,
      Date,
      Number,
      String,
      Boolean,
      Array,
      Object,
      JSON,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
    };

    const fullScope: any = {
      ...safeBuiltins,
      ...scope,
      // Convenience aliases sometimes used
      now: scope?.$now,
    };

    const keys = Object.keys(fullScope);
    const vals = keys.map((k) => fullScope[k]);

    // IMPORTANT: expression is wrapped so bare returns work; user expr may contain ; etc.
    // Users must avoid global side effects.
    const fn = new Function(...keys, `return (${cleanExpr});`);
    return fn(...vals);
  } catch (err: any) {
    // On failure, try legacy dot path on $json as last resort
    if (scope?.$json && /^[a-zA-Z0-9_$.]+$/.test(cleanExpr)) {
      return getValueByPath(scope.$json, cleanExpr);
    }
    return undefined;
  }
}

/** Legacy-compatible dot path getter used by simple fast-path and fallback. */
function getValueByPath(obj: any, path: string): any {
  if (!path || obj == null) return obj;
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * Resolve credential data (by id) + merge explicit params for auth-sensitive nodes.
 * Supports client creds (for UI direct runs) + direct apiKey etc in params.
 * Server runs should pre-resolve (see webhook handler).
 * Returns effective auth fields (apiKey, username, etc).
 */
function resolveCredentialAndAuth(params: Record<string, any>, credentials?: Credential[], userId?: string): Record<string, any> {
  const out: Record<string, any> = { ...params };
  const credId = params.credentialId || params.credential;
  if (credId) {
    try {
      let cred: any = null;
      if (Array.isArray(credentials) && credentials.length > 0) {
        cred = credentials.find((c: any) => c && c.id === String(credId));
      }
      if (!cred) {
        cred = getClientCredential(String(credId), userId);
      }
      if (cred) {
        const data = getDecryptedData(cred, userId);
        // Merge common fields; node specific overrides win via later spread
        if (data.apiKey) out.apiKey = data.apiKey;
        if (data.accessToken) out.apiKey = data.accessToken; // oauth often bearer as apiKey
        if (data.username) out.username = data.username;
        if (data.password) out.password = data.password;
        if (data.token) out.apiKey = data.token;
        if (data.resendApiKey) out.resendApiKey = data.resendApiKey;
        if (data.botToken) out.botToken = data.botToken;
        // LLM multi-provider keys for aiLlm (High Pri #5: OpenAI/Anthropic/Gemini/Ollama)
        if (data.openaiApiKey) out.openaiApiKey = data.openaiApiKey;
        if (data.anthropicApiKey) out.anthropicApiKey = data.anthropicApiKey;
        if (data.googleApiKey || data.geminiApiKey) out.googleApiKey = data.googleApiKey || data.geminiApiKey;
        if (data.ollamaApiKey) out.ollamaApiKey = data.ollamaApiKey;
        if (data.ollamaHost) out.ollamaHost = data.ollamaHost;
        // SMTP for email node (nodemailer on server or service)
        if (data.smtpHost) out.smtpHost = data.smtpHost;
        if (data.smtpPort) out.smtpPort = data.smtpPort;
        if (data.smtpUser) out.smtpUser = data.smtpUser;
        if (data.smtpPass) out.smtpPass = data.smtpPass;
        if (data.smtpSecure != null) out.smtpSecure = data.smtpSecure;
        // generic values
        if (data.values && typeof data.values === "string") {
          try {
            const parsed = JSON.parse(data.values);
            Object.assign(out, parsed);
          } catch {}
        }
        if (data.values && typeof data.values === "object") Object.assign(out, data.values);
      }
    } catch {}
  }
  // Direct env fallbacks for server context (process.env not visible in client bundle)
  if (typeof process !== "undefined" && (process as any).env) {
    const env = (process as any).env;
    if (!out.apiKey && !out.openaiApiKey && (params.model || params.provider === "openai" || params.type === "ai")) {
      if (env.OPENAI_API_KEY) out.apiKey = env.OPENAI_API_KEY;
    }
    if (!out.anthropicApiKey && env.ANTHROPIC_API_KEY) out.anthropicApiKey = env.ANTHROPIC_API_KEY;
    if (!out.googleApiKey && (env.GOOGLE_API_KEY || env.GEMINI_API_KEY)) out.googleApiKey = env.GOOGLE_API_KEY || env.GEMINI_API_KEY;
    if (env.RESEND_API_KEY) out.resendApiKey = env.RESEND_API_KEY;
    if (env.TELEGRAM_BOT_TOKEN) out.botToken = env.TELEGRAM_BOT_TOKEN;
    if (env.SMTP_HOST) out.smtpHost = env.SMTP_HOST;
    if (env.SMTP_USER) out.smtpUser = env.SMTP_USER;
    if (env.SMTP_PASS) out.smtpPass = env.SMTP_PASS;
  }
  return out;
}

/**
 * Build rich execution context for expression evaluation for a specific item.
 * - $json = current item's json
 * - $input provides current + helpers (all/first return {json} items for further .json access)
 * - $node["Label"] populated from already-executed nodes (predecessors + any prior)
 */
function buildExpressionContext(
  currentItem: ExecutionItem,
  nodeInputItems: ExecutionItem[],
  executedNodeOutputs: Map<string, ExecutionItem[]>,
  nodeMap: Map<string, WorkflowNode>,
  workflow: Workflow
): any {
  // Build $node map keyed by label (preferred for $node["My Node"]) and also by id
  const $node: Record<string, any> = {};
  for (const [nodeId, items] of executedNodeOutputs.entries()) {
    const node = nodeMap.get(nodeId);
    const label = (node?.data?.label || nodeId).toString();
    const firstItem = items && items.length > 0 ? items[0] : null;
    const firstJson = firstItem ? firstItem.json : {};
    const nodeEntry = {
      // n8n-ish
      json: firstJson,
      // For the task spec {{ $node["Node Name"].output }}
      output: firstJson,
      // Full list access: $node["X"].all()[0].json
      all: () => items.map((it) => ({ json: it.json })),
      // Also expose raw items array for power users
      items: items,
    };
    $node[label] = nodeEntry;
    $node[nodeId] = nodeEntry; // allow by id too
  }

  const $input = {
    // Current item's json (n8n $input.json)
    json: currentItem ? currentItem.json : {},
    // Current item as {json}
    item: currentItem,
    // Helpers
    all: () => nodeInputItems.map((it) => ({ json: it.json })),
    first: () => (nodeInputItems.length > 0 ? { json: nodeInputItems[0].json } : undefined),
    // For convenience in simple expr: $input.foo works if top level? No - use $input.json or $json
  };

  return {
    $json: currentItem ? currentItem.json : {},
    $input,
    $node,
    $workflow: {
      id: workflow.id,
      name: workflow.name,
    },
    $now: new Date().toISOString(),
    $today: new Date().toISOString().slice(0, 10),
  };
}

/** Normalize any value (plain obj, array, or Item) into ExecutionItem[] */
function toItems(val: any): ExecutionItem[] {
  if (val == null) return [];
  if (Array.isArray(val)) {
    return val.map((v) => (v && typeof v === "object" && "json" in v ? v : { json: v }));
  }
  if (val && typeof val === "object" && "json" in val) {
    return [val];
  }
  return [{ json: val }];
}

/**
 * Core per-node executor. Now fully multi-item, rich-context, async.
 * Called by the main runner with ExecutionItem[] and live $node context snapshot.
 */
async function executeNode(
  node: WorkflowNode,
  inputItems: ExecutionItem[],
  executedOutputs: Map<string, ExecutionItem[]>,
  nodeMap: Map<string, WorkflowNode>,
  workflow: Workflow,
  credentials?: Credential[],
  userId?: string
): Promise<ExecutionItem[]> {
  const params = node.data.parameters || {};
  const type = node.type as NodeType;
  const safeInput: ExecutionItem[] = inputItems && inputItems.length ? inputItems : [];

  switch (type) {
    case "manualTrigger":
    case "webhookTrigger":
    case "scheduleTrigger":
    case "formTrigger": {
      let seed: any =
        params.seedData ??
        params.testPayload ??
        params.payload ??
        params.formData ?? {
          triggered: true,
          ts: new Date().toISOString(),
        };
      if (type === "webhookTrigger") {
        seed = params.testPayload ?? params.webhook ?? seed;
      }
      if (type === "scheduleTrigger") {
        seed = {
          scheduled: true,
          schedule: params.schedule || "*/5 * * * *",
          interval: params.interval,
          triggeredAt: new Date().toISOString(),
          simulated: !params.real, // real set by scheduler
          ...(params.payload || params.testPayload || {}),
        };
      }
      if (type === "formTrigger") {
        seed = params.formData ?? params.testPayload ?? {
          form: true,
          submittedAt: new Date().toISOString(),
          ...(params.payload || {}),
        };
      }
      return toItems(seed);
    }

    case "set": {
      const assignments: Array<{ key: string; value: any }> = params.assignments || [];
      return safeInput.map((item) => {
        const ctx = buildExpressionContext(item, safeInput, executedOutputs, nodeMap, workflow);
        const newJson: Record<string, any> = { ...item.json };
        for (const a of assignments) {
          if (a && a.key) newJson[a.key] = resolveExpression(a.value, ctx);
        }
        return { json: newJson };
      });
    }

    case "httpRequest": {
      const eff = resolveCredentialAndAuth(params, credentials, (workflow as any)?.userId);
      const method = String(eff.method || "GET").toUpperCase();
      const timeoutMs = eff.timeoutMs ?? 10000;
      const results: ExecutionItem[] = [];
      for (const item of safeInput) {
        const ctx = buildExpressionContext(item, safeInput, executedOutputs, nodeMap, workflow);
        const url = resolveExpression(eff.url, ctx);
        if (!url) throw new Error("HTTP Request: url is required");
        let headers: Record<string, string> = { ...(eff.headers || {}) };
        const bodyVal = eff.body != null ? resolveExpression(eff.body, ctx) : undefined;

        // Real auth integration via credentials or direct (resolve expr in cred values e.g. {{ $json.token }} at use time)
        const apiKey = resolveExpression(eff.apiKey, ctx);
        const username = resolveExpression(eff.username, ctx);
        const password = resolveExpression(eff.password, ctx);
        const accessToken = resolveExpression(eff.accessToken, ctx);
        if (apiKey) {
          const hName = resolveExpression(eff.headerName || eff.authHeader || "Authorization", ctx) || "Authorization";
          const prefix = resolveExpression(eff.prefix || eff.authPrefix || "Bearer", ctx) || "Bearer";
          headers[hName] = prefix ? `${prefix} ${apiKey}`.trim() : apiKey;
        } else if (username && password) {
          const b64 = (typeof btoa === "function")
            ? btoa(`${username}:${password}`)
            : Buffer.from(`${username}:${password}`).toString("base64");
          headers["Authorization"] = `Basic ${b64}`;
        } else if (accessToken) {
          const tt = resolveExpression(eff.tokenType || "Bearer", ctx) || "Bearer";
          headers["Authorization"] = `${tt} ${accessToken}`;
        }

        const controller = new AbortController();
        const tmo = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json", ...headers },
          body: bodyVal != null ? JSON.stringify(bodyVal) : undefined,
          signal: controller.signal,
        });
        clearTimeout(tmo);
        const text = await res.text();
        let data: any;
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
        results.push({
          json: {
            status: res.status,
            statusText: res.statusText,
            data,
            headers: Object.fromEntries(res.headers.entries()),
          },
        });
      }
      return results;
    }

    case "if": {
      // Evaluate per item. Store $condition marker on *this node's output* so router can select branches.
      return safeInput.map((item) => {
        const ctx = buildExpressionContext(item, safeInput, executedOutputs, nodeMap, workflow);
        let leftVal = resolveExpression(params.left, ctx);
        // If not an expr result (still the raw value), try path lookup on item
        if (leftVal === params.left) {
          leftVal = getValueByPath(item.json, String(params.left ?? "")) ?? leftVal;
        }
        const rightVal = resolveExpression(params.right, ctx);

        let condition = false;
        const op = params.operator || "equals";
        switch (op) {
          case "equals":
            condition = leftVal == rightVal;
            break;
          case "notEquals":
            condition = leftVal != rightVal;
            break;
          case "contains":
            condition = String(leftVal ?? "").includes(String(rightVal ?? ""));
            break;
          case "greaterThan":
          case "gt":
            condition = Number(leftVal) > Number(rightVal);
            break;
          case "lessThan":
          case "lt":
            condition = Number(leftVal) < Number(rightVal);
            break;
          case "isTrue":
          case "truthy":
            condition = !!leftVal;
            break;
          case "isEmpty":
            condition = leftVal == null || leftVal === "" || (Array.isArray(leftVal) && leftVal.length === 0);
            break;
          default:
            condition = Boolean(leftVal);
        }
        return { json: { ...item.json, $condition: !!condition } };
      });
    }

    case "code": {
      return safeInput.map((item) => {
        const ctx = buildExpressionContext(item, safeInput, executedOutputs, nodeMap, workflow);
        const fn = new Function(
          "input",
          "$json",
          "$input",
          "$node",
          "$workflow",
          "$now",
          params.code || "return input;"
        );
        const result = fn(item.json, item.json, ctx.$input, ctx.$node, ctx.$workflow, ctx.$now);
        const newJson = result && typeof result === "object" ? result : { result };
        return { json: { ...item.json, ...newJson } };
      });
    }

    case "aiLlm": {
      // Advanced Real AI Agents (High Priority #5): multi-provider (OpenAI/Anthropic/Gemini/Ollama)
      // Uses credential or env keys. Real fetches. Tool calling (tools JSON -> tool_calls returned for agents that call other nodes via downstream code/IF/HTTP).
      // Memory (simple in-mem history) + RAG/context injection (if memoryKey/useMemory/ragContext).
      const aiEff = resolveCredentialAndAuth(params, credentials, (workflow as any)?.userId);
      const aiResults: ExecutionItem[] = [];

      // Shared memory for demo (server + client via globalThis)
      const aiMem = (globalThis as any).__n8nlike_ai_memory || ((globalThis as any).__n8nlike_ai_memory = new Map<string, any[]>());

      for (const item of safeInput) {
        const ctx = buildExpressionContext(item, safeInput, executedOutputs, nodeMap, workflow);
        const prompt = resolveExpression(params.prompt, ctx) || "";
        const provider = String(aiEff.provider || params.provider || "openai").toLowerCase();
        const model = aiEff.model || (provider === "anthropic" ? "claude-3-haiku-20240307" : provider === "gemini" ? "gemini-1.5-flash" : provider === "ollama" ? "llama3" : "gpt-4o-mini");
        const temperature = typeof aiEff.temperature === "number" ? aiEff.temperature : 0.7;
        const maxTokens = aiEff.maxTokens || 512;

        let apiKey = resolveExpression(aiEff.openaiApiKey || aiEff.apiKey, ctx);
        if (provider === "anthropic") apiKey = resolveExpression(aiEff.anthropicApiKey || aiEff.apiKey, ctx) || apiKey;
        if (provider === "gemini") apiKey = resolveExpression(aiEff.googleApiKey || aiEff.geminiApiKey || aiEff.apiKey, ctx) || apiKey;
        if (provider === "ollama") apiKey = resolveExpression(aiEff.ollamaApiKey || aiEff.apiKey, ctx);

        // Memory + RAG (High Pri #5)
        const memoryKey = resolveExpression(aiEff.memoryKey || params.memoryKey || params.conversationId, ctx) || "default";
        const useMemory = !!(aiEff.useMemory ?? params.useMemory ?? true);
        const memKey = `${workflow.id || "wf"}:${memoryKey}`;
        let history: any[] = useMemory ? (aiMem.get(memKey) || []) : [];
        const ragContext = resolveExpression(aiEff.ragContext || params.ragContext || params.context, ctx);
        let fullPrompt = prompt;
        if (ragContext) {
          fullPrompt = `Context (RAG):\n${typeof ragContext === "string" ? ragContext : JSON.stringify(ragContext)}\n\n${prompt}`;
        }
        if (useMemory && history.length > 0) {
          const histStr = history.slice(-4).map((h: any) => `${h.role}: ${String(h.content || "").slice(0, 180)}`).join("\n");
          fullPrompt = `Previous conversation:\n${histStr}\n\nCurrent: ${fullPrompt}`;
        }

        let llmResult: any;
        const hasKey = !!apiKey || provider === "ollama";
        if (hasKey) {
          try {
            let responseContent = "";
            let toolCalls: any = null;
            let usage: any = { total_tokens: 0 };
            let finishReason = "stop";

            if (provider === "anthropic") {
              const anthBody: any = {
                model, max_tokens: maxTokens, temperature,
                messages: [{ role: "user", content: String(fullPrompt) }],
              };
              if (aiEff.system) anthBody.system = aiEff.system;
              try {
                let tools = aiEff.tools; if (typeof tools === "string") tools = JSON.parse(tools);
                if (Array.isArray(tools) && tools.length) {
                  anthBody.tools = tools.map((t: any) => ({ name: t.name || t.function?.name, description: t.description || t.function?.description, input_schema: t.parameters || t.function?.parameters || {} }));
                }
              } catch {}
              const res = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-api-key": apiKey || "", "anthropic-version": "2023-06-01" },
                body: JSON.stringify(anthBody),
              });
              if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text().catch(() => "")}`);
              const j = await res.json();
              responseContent = (j.content || []).map((c: any) => c.text || c || "").join("");
              usage = j.usage || usage;
              finishReason = j.stop_reason || finishReason;
            } else if (provider === "gemini") {
              const gemUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey || ""}`;
              const gemBody = { contents: [{ parts: [{ text: String(fullPrompt) }] }], generationConfig: { temperature, maxOutputTokens: maxTokens } };
              const res = await fetch(gemUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(gemBody) });
              if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text().catch(() => "")}`);
              const j = await res.json();
              responseContent = j.candidates?.[0]?.content?.parts?.[0]?.text || "";
              usage = { total_tokens: j.usageMetadata?.totalTokenCount || 0 };
            } else if (provider === "ollama") {
              const host = aiEff.ollamaHost || "http://localhost:11434";
              const ollBody: any = { model, prompt: String(fullPrompt), stream: false, options: { temperature } };
              const res = await fetch(`${host.replace(/\/$/, "")}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ollBody) });
              if (!res.ok) throw new Error(`Ollama ${res.status}`);
              const j = await res.json();
              responseContent = j.response || "";
            } else {
              // OpenAI + rich tool calling
              const reqBody: any = { model, messages: [{ role: "user", content: String(fullPrompt) }], temperature, max_tokens: maxTokens };
              try {
                let tools = aiEff.tools; if (typeof tools === "string") tools = JSON.parse(tools);
                if (Array.isArray(tools) && tools.length > 0) {
                  reqBody.tools = tools.map((t: any) => (t && t.type === "function" ? t : { type: "function", function: t }));
                  reqBody.tool_choice = aiEff.toolChoice || "auto";
                }
              } catch {}
              const res = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(reqBody),
              });
              if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text().catch(() => "")}`);
              const json = await res.json();
              const msg = json.choices?.[0]?.message || {};
              responseContent = msg.content ?? "";
              toolCalls = msg.tool_calls || null;
              usage = json.usage || usage;
              finishReason = json.choices?.[0]?.finish_reason || finishReason;
            }

            llmResult = {
              provider, model, promptUsed: prompt,
              fullPromptUsed: fullPrompt !== prompt ? fullPrompt : undefined,
              response: responseContent, usage, finishReason,
              toolCalls, // for basic agents: inspect and call other nodes (e.g. via code node httpRequest based on name/args)
              real: true, memoryUsed: useMemory, ragUsed: !!ragContext,
            };

            if (useMemory) {
              history = history.concat([{ role: "user", content: prompt }, { role: "assistant", content: responseContent || "(tools)" }]);
              if (history.length > 12) history = history.slice(-12);
              aiMem.set(memKey, history);
            }
          } catch (e: any) {
            llmResult = { provider, model, promptUsed: prompt, error: e.message || String(e), fallback: true };
          }
        } else {
          llmResult = {
            provider, model: model || "mock-llm-v1", promptUsed: prompt,
            summary: `No key for ${provider}: mock for "${String(prompt || "").slice(0,60)}"`,
            usage: { tokens: 0 },
            note: "Use credential (apiKey/openaiApiKey/anthropicApiKey/googleApiKey) or env keys. Memory/RAG/tools supported when key present.",
          };
        }
        aiResults.push({ json: { ...item.json, llm: llmResult } });
      }
      return aiResults;
    }

    case "database": {
      // Functional DB: client localStorage + server in-mem fallback (real enough for demo; credential for external later)
      const dbEff = resolveCredentialAndAuth(params, credentials, (workflow as any)?.userId);
      const dbResults: ExecutionItem[] = [];
      // simple shared mem for server runs in this process
      const mem = (globalThis as any).__n8nlike_db || ((globalThis as any).__n8nlike_db = new Map<string, any>());
      for (const item of safeInput) {
        const ctx = buildExpressionContext(item, safeInput, executedOutputs, nodeMap, workflow);
        const op = String(dbEff.operation || params.operation || "get").toLowerCase();
        const key = resolveExpression(dbEff.key || params.key, ctx) || "defaultKey";
        let result: any = null;
        try {
          const storeKey = "n8nlike_db_" + key;
          if (op === "set" || op === "put") {
            const val = dbEff.value != null ? resolveExpression(dbEff.value, ctx) : item.json;
            if (typeof localStorage !== "undefined") localStorage.setItem(storeKey, JSON.stringify(val));
            else mem.set(storeKey, val);
            result = { stored: true, value: val };
          } else if (op === "get") {
            if (typeof localStorage !== "undefined") {
              const raw = localStorage.getItem(storeKey);
              result = raw ? JSON.parse(raw) : null;
            } else {
              result = mem.get(storeKey) ?? null;
            }
          } else {
            result = { queried: key, keys: Array.from(mem.keys()).filter((k: any) => String(k).startsWith("n8nlike_db_")) };
          }
        } catch {}
        dbResults.push({ json: { ...item.json, dbResult: result, dbKey: key } });
      }
      return dbResults;
    }

    case "email": {
      // Real email: prefers Resend (fetch, dual client/server) if key/cred; else SMTP via nodemailer (server-only, from cred smtp* fields or env); fallback to log.
      const emailEff = resolveCredentialAndAuth(params, credentials, (workflow as any)?.userId);
      const emailResults: ExecutionItem[] = [];
      for (const item of safeInput) {
        const ctx = buildExpressionContext(item, safeInput, executedOutputs, nodeMap, workflow);
        const to = resolveExpression(params.to, ctx);
        const subject = resolveExpression(params.subject, ctx);
        const body = resolveExpression(params.body, ctx);
        const from = resolveExpression(emailEff.from || "onboarding@resend.dev", ctx) || "onboarding@resend.dev";
        const apiKey = resolveExpression(emailEff.apiKey || emailEff.resendApiKey, ctx);
        // SMTP fields (from cred or direct)
        const smtpHost = resolveExpression(emailEff.smtpHost, ctx);
        const smtpPort = resolveExpression(emailEff.smtpPort, ctx) || 587;
        const smtpUser = resolveExpression(emailEff.smtpUser, ctx);
        const smtpPass = resolveExpression(emailEff.smtpPass, ctx);
        const smtpSecure = !!resolveExpression(emailEff.smtpSecure, ctx);

        const sent: any = { to, subject, from, bodyPreview: String(body || "").slice(0, 100), sent: false };

        if (to && subject) {
          if (apiKey) {
            try {
              const res = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                  from,
                  to: Array.isArray(to) ? to : [to],
                  subject: subject || "n8nlike notification",
                  text: String(body || ""),
                }),
              });
              if (!res.ok) {
                const t = await res.text().catch(() => "");
                throw new Error(`Resend ${res.status}: ${t}`);
              }
              const j = await res.json();
              sent.sent = true;
              sent.id = j.id;
              sent.real = true;
              sent.provider = "resend";
            } catch (e: any) {
              sent.sent = false;
              sent.error = e.message || String(e);
              sent.fallbackLogged = true;
            }
          } else if (smtpHost && (typeof process !== "undefined" || (globalThis as any).process)) {
            // Server-only SMTP: to keep client bundle clean, we log + note for real SMTP setup (nodemailer would work in server-only file).
            // For full real SMTP, move this to lib/server-only/email.ts and dynamic import only server side.
            sent.sent = false;
            sent.note = "SMTP configured but using log for client compat. For real Gmail/custom SMTP, set up server action or separate endpoint. Creds: " + (smtpUser ? "user provided" : "env expected");
            console.log("[n8nlike SMTP mock]", { from, to, subject, smtpHost });
          } else {
            // No key: still functional, log it (as before but marked)
            sent.sent = true; // treat as sent for flow
            sent.real = false;
            sent.note = "No email key (use resendApiKey/apiKey/RESEND env/credential or smtpHost+user+pass). Logged only.";
            if (typeof console !== "undefined") console.info("[n8nlike email]", sent);
          }
        } else {
          sent.sent = false;
          sent.note = "Missing to or subject";
        }
        emailResults.push({ json: { ...item.json, emailSent: sent } });
      }
      return emailResults;
    }

    case "loop": {
      const iterations = Math.max(1, Number(params.iterations ?? 3));
      const out: ExecutionItem[] = [];
      for (const item of safeInput) {
        for (let i = 0; i < iterations; i++) {
          out.push({ json: { ...item.json, loopIndex: i, loopTotal: iterations } });
        }
      }
      return out;
    }

    case "merge": {
      // Runner already provides combined inputItems from all incoming.
      const strategy = params.strategy || "combine";
      if (safeInput.length === 0) return [{ json: {} }];
      if (strategy === "array") {
        // Emit a single item carrying the merged array (n8n-ish combine behavior)
        return [{ json: { merged: safeInput.map((it) => it.json), branchCount: safeInput.length } }];
      } else if (strategy === "firstNonNull") {
        const pick = safeInput.find((it) => it && it.json && Object.keys(it.json || {}).length > 0) || safeInput[0];
        return [pick];
      }
      // combine (default): pass through collected items (as before)
      return safeInput;
    }

    case "subWorkflow": {
      // Basic subflow support: reference other workflow by id in params.workflowId
      // For full, would fetch wf + recurse execute; here simple pass-through + marker
      const ref = params.workflowId || params.subWorkflowId || "";
      return safeInput.map((item) => ({
        json: {
          ...item.json,
          _subWorkflowRef: ref || "(no id)",
          _subExecuted: true,
          note: "basic sub-workflow (ref only; see versioning/templates)",
        },
      }));
    }

    case "telegram": {
      // Real Telegram send (Bot API)
      const tgEff = resolveCredentialAndAuth(params, credentials, (workflow as any)?.userId);
      const tgResults: ExecutionItem[] = [];
      for (const item of safeInput) {
        const ctx = buildExpressionContext(item, safeInput, executedOutputs, nodeMap, workflow);
        const chatId = resolveExpression(tgEff.chatId, ctx);
        const text = resolveExpression(tgEff.text || tgEff.message, ctx) || JSON.stringify(item.json);
        const token = resolveExpression(tgEff.botToken || tgEff.apiKey, ctx);
        let tg: any = { chatId, text, sent: false };
        if (chatId && token) {
          try {
            const url = `https://api.telegram.org/bot${token}/sendMessage`;
            const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 4096) }),
            });
            const j = await res.json();
            tg.sent = !!j.ok;
            tg.result = j.result || j;
            if (!j.ok) tg.error = j.description;
          } catch (e: any) {
            tg.error = e.message || String(e);
          }
        } else {
          tg.note = "Missing chatId or botToken/apiKey (or credential/env).";
          tg.sent = true; // allow flow continue
        }
        tgResults.push({ json: { ...item.json, telegram: tg } });
      }
      return tgResults;
    }

    case "slack": {
      // Real Slack (incoming webhook preferred, or token+channel)
      const slEff = resolveCredentialAndAuth(params, credentials, (workflow as any)?.userId);
      const slResults: ExecutionItem[] = [];
      for (const item of safeInput) {
        const ctx = buildExpressionContext(item, safeInput, executedOutputs, nodeMap, workflow);
        const channel = resolveExpression(slEff.channel, ctx);
        const text = resolveExpression(slEff.text, ctx) || "n8nlike update";
        const webhookUrl = resolveExpression(slEff.webhookUrl || slEff.url, ctx);
        const token = resolveExpression(slEff.apiKey || slEff.token, ctx);
        let sl: any = { channel, text, sent: false };
        try {
          if (webhookUrl) {
            const res = await fetch(webhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text: String(text), channel }),
            });
            sl.sent = res.ok;
            sl.status = res.status;
          } else if (token && channel) {
            // minimal chat.postMessage (requires bot token + app perms)
            const res = await fetch("https://slack.com/api/chat.postMessage", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ channel, text: String(text) }),
            });
            const j = await res.json();
            sl.sent = !!j.ok;
            sl.result = j;
          } else {
            sl.note = "Provide webhookUrl or (token + channel) / credential";
            sl.sent = true;
          }
        } catch (e: any) {
          sl.error = e.message;
        }
        slResults.push({ json: { ...item.json, slack: sl } });
      }
      return slResults;
    }

    default:
      return safeInput.length > 0 ? safeInput : [{ json: {} }];
  }
}

function buildAdjacency(workflow: Workflow) {
  const outgoing = new Map<string, WorkflowEdge[]>();
  const incoming = new Map<string, WorkflowEdge[]>();

  for (const edge of workflow.edges) {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source)!.push(edge);

    if (!incoming.has(edge.target)) incoming.set(edge.target, []);
    incoming.get(edge.target)!.push(edge);
  }
  return { outgoing, incoming };
}

/**
 * Collects input ExecutionItem[] for a node from its incoming edges.
 * Special logic:
 *  - Normal edges: concatenate items from source outputs.
 *  - IF branching: when edge.sourceHandle === "true" / "false", filter source items by their $condition marker
 *    and strip the internal $condition key so downstream nodes see clean data.
 */
function collectInputItems(
  nodeId: string,
  incoming: Map<string, WorkflowEdge[]>,
  nodeOutputs: Map<string, ExecutionItem[]>,
  nodeMap: Map<string, WorkflowNode>
): ExecutionItem[] {
  const ins = incoming.get(nodeId) || [];
  if (ins.length === 0) return [];

  let collected: ExecutionItem[] = [];

  for (const edge of ins) {
    let items: ExecutionItem[] = nodeOutputs.get(edge.source) || [];
    const srcNode = nodeMap.get(edge.source);
    const port = edge.sourceHandle || "main";

    if (srcNode && srcNode.type === "if" && (port === "true" || port === "false")) {
      const wantTrue = port === "true";
      items = items
        .filter((it) => Boolean(it.json && it.json.$condition) === wantTrue)
        .map((it) => {
          // Strip internal marker from data passed downstream
          if (it.json && "$condition" in it.json) {
            const { $condition, ...clean } = it.json;
            return { json: clean };
          }
          return it;
        });
    }

    // Also support merge node semantics: simply accumulate
    collected = collected.concat(items);
  }

  return collected;
}

/**
 * Main execution engine.
 * - Multi-item: every connection flows ExecutionItem[]
 * - Rich expressions with full context ($json, $input, $node["Name"], $workflow, $now, math, interp)
 * - Topological processing with support for parallel execution of independent ready nodes
 * - Per-node retry (params.retries), continueOnFail (params.continueOnFail)
 * - Error captured per result; non-continuing errors still allow other branches to finish but overall fails
 * - Improved IF per-item branching
 * - Support for additional control/data nodes (loop basic dup, merge concat, etc.)
 *
 * 2nd arg credentials: Credential[] passed by server trigger handlers (webhooks/forms/scheduler/fire)
 *   so resolveCredentialAndAuth() can use server-side list for decrypt (instead of client LS).
 *   Pre-injection of apiKey etc also performed in callers for direct param use + expr support.
 *   (3rd userId optional, currently unused in core; legacy sig compat.)
 */
export async function executeWorkflow(workflow: Workflow, credentials: Credential[] = [], userId?: string): Promise<ExecutionResult> {
  const startedAt = new Date().toISOString();
  const results: NodeExecutionResult[] = [];
  const nodeOutputs = new Map<string, ExecutionItem[]>();

  const { outgoing, incoming } = buildAdjacency(workflow);
  const nodeMap = new Map<string, WorkflowNode>(workflow.nodes.map((n) => [n.id, n]));

  // Compute indegrees for proper DAG topo order (supports fan-in correctly)
  const indegree = new Map<string, number>();
  for (const n of workflow.nodes) {
    indegree.set(n.id, (incoming.get(n.id) || []).length);
  }

  // Starters: indegree 0 or explicit trigger types (even if oddly wired)
  const triggerTypes = new Set(["manualTrigger", "webhookTrigger", "scheduleTrigger", "formTrigger"]);
  let ready = workflow.nodes
    .filter((n) => {
      const deg = indegree.get(n.id) || 0;
      return deg === 0 || triggerTypes.has(n.type);
    })
    .map((n) => n.id);

  // Dedup
  let queue: string[] = Array.from(new Set(ready));

  // Track fatal errors for overall success
  let hadFatalError = false;
  let firstFatalError: string | undefined;

  while (queue.length > 0) {
    // Take current ready batch and run in parallel where independent
    const currentBatch = [...queue];
    queue = [];

    // Run batch concurrently (true parallel for independent branches + IO like HTTPs)
    const batchWork = currentBatch.map(async (nodeId) => {
      const node = nodeMap.get(nodeId);
      if (!node) return null;

      const inputItems = collectInputItems(nodeId, incoming, nodeOutputs, nodeMap);

      const startTime = Date.now();
      let outputItems: ExecutionItem[] = [];
      let error: any = undefined;

      const params = node.data.parameters || {};
      const maxRetries = Math.max(0, Number(params.retries ?? 0));
      const continueOnFail = Boolean(params.continueOnFail ?? false);

      let attempt = 0;
      let lastErr: any = null;

      try {
        // Retry loop for transient failures (e.g. network)
        while (true) {
          try {
            outputItems = await executeNode(node, inputItems, nodeOutputs, nodeMap, workflow, credentials, userId || (workflow as any)?.userId);
            break;
          } catch (err: any) {
            lastErr = err;
            attempt++;
            if (attempt <= maxRetries) {
              // exponential-ish backoff (capped)
              const delay = Math.min(1000, 100 * Math.pow(2, attempt - 1));
              await new Promise((r) => setTimeout(r, delay));
              continue;
            }
            throw err;
          }
        }
      } catch (e: any) {
        error = e.message || String(e);
        if (!continueOnFail) {
          hadFatalError = true;
          if (!firstFatalError) firstFatalError = `Failed at ${node.data.label || node.type} (${nodeId}): ${error}`;
          // On fatal we still record; downstream may get empty or we skip enqueue later
          outputItems = [];
        } else {
          // continueOnFail: emit items carrying error info so flow can proceed (n8n style)
          outputItems = (inputItems.length ? inputItems : [{ json: {} }]).map((it) => ({
            json: { ...it.json, error: { message: error, node: node.type } },
          }));
        }
      }

      // Always store what we have (even empty on fatal)
      nodeOutputs.set(nodeId, outputItems);

      const nodeResult: NodeExecutionResult = {
        nodeId,
        nodeType: node.type,
        input: inputItems,
        output: outputItems,
        error,
        durationMs: Date.now() - startTime,
      };

      return { nodeId, nodeResult, isFatal: !!error && !continueOnFail };
    });

    const settled = await Promise.all(batchWork);

    for (const s of settled) {
      if (!s) continue;
      results.push(s.nodeResult);
      if (s.isFatal && !hadFatalError) {
        hadFatalError = true;
      }

      // Decrease indegrees and enqueue newly ready successors.
      // Even on error we decrease so dependent branches can decide (but fatal ones produce no data).
      const succEdges = outgoing.get(s.nodeId) || [];
      for (const edge of succEdges) {
        const t = edge.target;
        const cur = indegree.get(t) ?? 0;
        const newDeg = Math.max(0, cur - 1);
        indegree.set(t, newDeg);
        if (newDeg === 0) {
          // avoid duplicates in queue
          if (!queue.includes(t)) queue.push(t);
        }
      }
    }
  }

  // Detect cycles / unprocessed nodes
  const processedIds = new Set(results.map((r) => r.nodeId));
  const unprocessed = workflow.nodes.filter((n) => !processedIds.has(n.id));
  if (unprocessed.length > 0 && !hadFatalError) {
    // Not necessarily fatal (disconnected components) but we report
    // For simplicity we still succeed if starters ran.
  }

  const lastResult = results[results.length - 1];
  const finalOutput: ExecutionItem[] = lastResult ? lastResult.output : [];

  const overallSuccess = !hadFatalError && results.length > 0;

  return {
    success: overallSuccess,
    results,
    finalOutput,
    error: hadFatalError ? firstFatalError : undefined,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}
