import { v4 as uuidv4 } from "uuid";
import { ExecutionResult, ExecutionRecord, Workflow } from "./types";

const STORAGE_KEY = "n8nlike-executions";
const MAX_RECORDS = 50;

export function saveExecution(result: ExecutionResult, workflow: Workflow): ExecutionRecord {
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
  };

  const existing = listExecutions();
  // Prepend newest first
  const updated = [record, ...existing].slice(0, MAX_RECORDS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    // quota or private mode; ignore gracefully
    console.warn("Failed to persist execution history", e);
  }
  return record;
}

export function listExecutions(): ExecutionRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function getExecution(id: string): ExecutionRecord | null {
  return listExecutions().find((e) => e.id === id) ?? null;
}

export function clearExecutions(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function deleteExecution(id: string): void {
  try {
    const filtered = listExecutions().filter((e) => e.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch {}
}
