import {
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  ExecutionResult,
  NodeExecutionResult,
  NodeType,
  ExecutionItem,
} from "./types";
import { getNodeDefinition } from "./nodes";

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
  workflow: Workflow
): Promise<ExecutionItem[]> {
  const params = node.data.parameters || {};
  const type = node.type as NodeType;
  const safeInput: ExecutionItem[] = inputItems && inputItems.length ? inputItems : [];

  switch (type) {
    case "manualTrigger":
    case "webhookTrigger":
    case "scheduleTrigger": {
      let seed: any =
        params.seedData ??
        params.testPayload ??
        params.payload ?? {
          triggered: true,
          ts: new Date().toISOString(),
        };
      if (type === "webhookTrigger") seed = params.testPayload ?? seed;
      if (type === "scheduleTrigger") {
        seed = {
          scheduled: true,
          schedule: params.schedule || "*/5 * * * *",
          interval: params.interval,
          triggeredAt: new Date().toISOString(),
          simulated: true,
          ...(params.payload || params.testPayload || {}),
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
      const method = String(params.method || "GET").toUpperCase();
      const timeoutMs = params.timeoutMs ?? 10000;
      const results: ExecutionItem[] = [];
      for (const item of safeInput) {
        const ctx = buildExpressionContext(item, safeInput, executedOutputs, nodeMap, workflow);
        const url = resolveExpression(params.url, ctx);
        if (!url) throw new Error("HTTP Request: url is required");
        const headers = params.headers || {};
        const bodyVal = params.body != null ? resolveExpression(params.body, ctx) : undefined;

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
      return safeInput.map((item) => {
        const ctx = buildExpressionContext(item, safeInput, executedOutputs, nodeMap, workflow);
        const prompt = resolveExpression(params.prompt, ctx);
        return {
          json: {
            ...item.json,
            llm: {
              model: params.model || "mock-llm-v1",
              promptUsed: prompt,
              summary: `Mock summary for: ${String(prompt || "input").slice(0, 50)}`,
              sentiment: 0.42,
              usage: { tokens: 17 },
            },
          },
        };
      });
    }

    case "database": {
      return safeInput.map((item) => {
        const ctx = buildExpressionContext(item, safeInput, executedOutputs, nodeMap, workflow);
        const op = String(params.operation || "get").toLowerCase();
        const key = resolveExpression(params.key, ctx) || "defaultKey";
        let result: any = null;
        try {
          const storeKey = "n8nlike_db_" + key;
          if (op === "set" || op === "put") {
            const val = params.value != null ? resolveExpression(params.value, ctx) : item.json;
            if (typeof localStorage !== "undefined") localStorage.setItem(storeKey, JSON.stringify(val));
            result = { stored: true, value: val };
          } else if (op === "get") {
            const raw = typeof localStorage !== "undefined" ? localStorage.getItem(storeKey) : null;
            result = raw ? JSON.parse(raw) : null;
          } else {
            result = { queried: key };
          }
        } catch {}
        return { json: { ...item.json, dbResult: result, dbKey: key } };
      });
    }

    case "email": {
      return safeInput.map((item) => {
        const ctx = buildExpressionContext(item, safeInput, executedOutputs, nodeMap, workflow);
        const to = resolveExpression(params.to, ctx);
        const subject = resolveExpression(params.subject, ctx);
        const body = resolveExpression(params.body, ctx);
        const sent = { to, subject, sent: true, bodyPreview: String(body || "").slice(0, 100) };
        if (typeof console !== "undefined") console.info("[n8nlike mock email]", sent);
        return { json: { ...item.json, emailSent: sent } };
      });
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
 */
export async function executeWorkflow(workflow: Workflow): Promise<ExecutionResult> {
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
  const triggerTypes = new Set(["manualTrigger", "webhookTrigger", "scheduleTrigger"]);
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
            outputItems = await executeNode(node, inputItems, nodeOutputs, nodeMap, workflow);
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
