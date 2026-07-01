import { v4 as uuidv4 } from "uuid";
import { ExecutionResult, ExecutionRecord, Workflow } from "./types";

const BASE_STORAGE_KEY = "n8nlike-executions";
const MAX_RECORDS = 50;

function getStorageKey(userId?: string) {
  return userId ? `${BASE_STORAGE_KEY}-${userId}` : BASE_STORAGE_KEY;
}

export function saveExecution(result: ExecutionResult & { userId?: string }, workflow: Workflow, userId?: string): ExecutionRecord {
  const effectiveUserId = userId || (result as any)?.userId;
  const record: ExecutionRecord = {
    id: uuidv4(),
    workflowId: workflow.id,
    workflowName: workflow.name || "Untitled",
    workflowSnapshot: {
      name: workflow.name || "Untitled",
      nodes: JSON.parse(JSON.stringify(workflow.nodes)), // deep copy snapshot
      edges: JSON.parse(JSON.stringify(workflow.edges)),
    },
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    success: result.success,
    results: JSON.parse(JSON.stringify(result.results)),
    finalOutput: result.finalOutput,
    error: result.error,
    // attach for downstream if needed
    ...(effectiveUserId ? { userId: effectiveUserId } as any : {}),
  };

  const existing = listExecutions(effectiveUserId);
  // Prepend newest first
  const updated = [record, ...existing].slice(0, MAX_RECORDS);
  try {
    localStorage.setItem(getStorageKey(effectiveUserId), JSON.stringify(updated));
  } catch (e) {
    // quota or private mode; ignore gracefully
    console.warn("Failed to persist execution history", e);
  }
  return record;
}

export function listExecutions(userId?: string): ExecutionRecord[] {
  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function getExecution(id: string, userId?: string): ExecutionRecord | null {
  return listExecutions(userId).find((e) => e.id === id) ?? null;
}

export function clearExecutions(userId?: string): void {
  try {
    localStorage.removeItem(getStorageKey(userId));
  } catch {}
}

export function deleteExecution(id: string, userId?: string): void {
  try {
    const filtered = listExecutions(userId).filter((e) => e.id !== id);
    localStorage.setItem(getStorageKey(userId), JSON.stringify(filtered));
  } catch {}
}
