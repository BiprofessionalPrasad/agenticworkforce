import { promises as fs } from "fs";
import path from "path";
import { Workflow, StoredExecution } from "./types";
import { v4 as uuidv4 } from "uuid";

const DATA_DIR = path.join(process.cwd(), "data");
const WORKFLOWS_FILE = path.join(DATA_DIR, "workflows.json");
const EXECUTIONS_FILE = path.join(DATA_DIR, "executions.json");

// Ensure data directory and files exist
async function ensureDataDir(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (e) {
    // ignore
  }
}

async function readJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
  await ensureDataDir();
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return defaultValue;
  }
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await ensureDataDir();
  const tmp = filePath + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmp, filePath); // atomic-ish replace
}

// --- Workflows ---
export async function getAllWorkflows(): Promise<Workflow[]> {
  const map = await readJsonFile<Record<string, Workflow>>(WORKFLOWS_FILE, {});
  return Object.values(map).sort((a, b) => {
    const ta = a.updatedAt || a.createdAt || "";
    const tb = b.updatedAt || b.createdAt || "";
    return tb.localeCompare(ta);
  });
}

export async function getWorkflow(id: string): Promise<Workflow | null> {
  const map = await readJsonFile<Record<string, Workflow>>(WORKFLOWS_FILE, {});
  return map[id] ?? null;
}

export async function saveWorkflow(workflow: Workflow): Promise<Workflow> {
  const map = await readJsonFile<Record<string, Workflow>>(WORKFLOWS_FILE, {});
  const now = new Date().toISOString();
  const existing = map[workflow.id];
  const toSave: Workflow = {
    ...workflow,
    createdAt: existing?.createdAt || workflow.createdAt || now,
    updatedAt: now,
  };
  map[workflow.id] = toSave;
  await writeJsonFile(WORKFLOWS_FILE, map);
  return toSave;
}

export async function createWorkflow(name: string, nodes: Workflow["nodes"] = [], edges: Workflow["edges"] = []): Promise<Workflow> {
  const id = `wf-${uuidv4().slice(0, 12)}`;
  const wf: Workflow = {
    id,
    name,
    nodes,
    edges,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return saveWorkflow(wf);
}

export async function deleteWorkflow(id: string): Promise<boolean> {
  const map = await readJsonFile<Record<string, Workflow>>(WORKFLOWS_FILE, {});
  if (!map[id]) return false;
  delete map[id];
  await writeJsonFile(WORKFLOWS_FILE, map);
  return true;
}

// --- Executions ---
export async function getAllExecutions(workflowId?: string): Promise<StoredExecution[]> {
  const list = await readJsonFile<StoredExecution[]>(EXECUTIONS_FILE, []);
  const filtered = workflowId ? list.filter((e) => e.workflowId === workflowId) : list;
  return filtered.sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
}

export async function saveExecution(execution: Omit<StoredExecution, "id"> & { id?: string }): Promise<StoredExecution> {
  const list = await readJsonFile<StoredExecution[]>(EXECUTIONS_FILE, []);
  const full: StoredExecution = {
    ...execution,
    id: execution.id || `exec-${uuidv4().slice(0, 12)}`,
  };
  list.unshift(full); // newest first
  // Keep only last 200 per workflow or overall to avoid unbounded growth
  const pruned = list.slice(0, 500);
  await writeJsonFile(EXECUTIONS_FILE, pruned);
  return full;
}
