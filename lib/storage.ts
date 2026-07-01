import { promises as fs } from "fs";
import path from "path";
import { Workflow, StoredExecution, Credential, WorkflowVersion, User } from "./types";
import { v4 as uuidv4 } from "uuid";
import { encryptCredentialData, decryptCredentialData } from "./credentials";

const DATA_DIR = path.join(process.cwd(), "data");
const WORKFLOWS_FILE = path.join(DATA_DIR, "workflows.json");
const EXECUTIONS_FILE = path.join(DATA_DIR, "executions.json");
const CREDENTIALS_FILE = path.join(DATA_DIR, "credentials.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");

// Ensure data directory and files exist
async function ensureDataDir(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    // Cleanup orphaned .tmp from prior atomic writes (MED-008/LOW-008). Rename back if no main, else rm.
    const files = [WORKFLOWS_FILE, EXECUTIONS_FILE, CREDENTIALS_FILE, USERS_FILE];
    for (const f of files) {
      const tmp = f + ".tmp";
      try {
        await fs.access(tmp);
        try {
          await fs.access(f);
          // main exists, remove stale tmp
          await fs.unlink(tmp).catch(() => {});
        } catch {
          // no main, promote tmp
          await fs.rename(tmp, f).catch(() => {});
        }
      } catch { /* no tmp */ }
    }
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
export async function getAllWorkflows(userId?: string): Promise<Workflow[]> {
  const map = await readJsonFile<Record<string, Workflow>>(WORKFLOWS_FILE, {});
  let list = Object.values(map);
  if (userId) {
    list = list.filter((w) => w.userId === userId);
  }
  return list.sort((a, b) => {
    const ta = a.updatedAt || a.createdAt || "";
    const tb = b.updatedAt || b.createdAt || "";
    return tb.localeCompare(ta);
  });
}

export async function getActiveWorkflows(userId?: string): Promise<Workflow[]> {
  const all = await getAllWorkflows(userId);
  return all.filter((w) => !!w.active);
}

export async function getWorkflow(id: string, userId?: string): Promise<Workflow | null> {
  const map = await readJsonFile<Record<string, Workflow>>(WORKFLOWS_FILE, {});
  const wf = map[id] ?? null;
  if (!wf) return null;
  if (userId && wf.userId && wf.userId !== userId) {
    return null; // ownership violation
  }
  return wf;
}

export async function saveWorkflow(workflow: Workflow, userId?: string): Promise<Workflow> {
  const map = await readJsonFile<Record<string, Workflow>>(WORKFLOWS_FILE, {});
  const now = new Date().toISOString();
  const existing = map[workflow.id];

  // Enforce user ownership for multi-tenancy
  const effectiveUserId = userId || workflow.userId || existing?.userId;

  // Versioning support: maintain versions array (backward compat: create if missing)
  let versions: WorkflowVersion[] = Array.isArray(workflow.versions) ? [...workflow.versions] : (existing?.versions || []);
  const prevNodes = existing?.nodes || [];
  const prevEdges = existing?.edges || [];
  const incomingNodes = workflow.nodes || [];
  const incomingEdges = workflow.edges || [];
  const nodesChanged = JSON.stringify(prevNodes) !== JSON.stringify(incomingNodes);
  const edgesChanged = JSON.stringify(prevEdges) !== JSON.stringify(incomingEdges);
  const nameChanged = (existing?.name || "") !== (workflow.name || "");

  if (existing && (nodesChanged || edgesChanged || nameChanged) && versions.length === 0) {
    // migrate legacy: seed first version from existing on first change
    versions.push({
      version: 1,
      name: existing.name,
      nodes: JSON.parse(JSON.stringify(existing.nodes || [])),
      edges: JSON.parse(JSON.stringify(existing.edges || [])),
      savedAt: existing.updatedAt || existing.createdAt || now,
    });
  }

  // Append new version for this save if there is structural/name change or first time
  const nextVersionNum = (versions.length > 0 ? Math.max(...versions.map(v => v.version)) : 0) + 1;
  if (!existing || nodesChanged || edgesChanged || nameChanged) {
    versions.push({
      version: nextVersionNum,
      name: workflow.name,
      nodes: JSON.parse(JSON.stringify(incomingNodes)),
      edges: JSON.parse(JSON.stringify(incomingEdges)),
      savedAt: now,
    });
    // Cap versions at 10 for storage bloat prevention (keep most recent)
    if (versions.length > 10) versions = versions.slice(-10);
  }

  const toSave: Workflow = {
    ...workflow,
    userId: effectiveUserId,
    createdAt: existing?.createdAt || workflow.createdAt || now,
    updatedAt: now,
    versions: versions.length ? versions : undefined,
    isPublished: typeof workflow.isPublished === "boolean" ? workflow.isPublished : (existing?.isPublished ?? false),
    active: typeof workflow.active === "boolean" ? workflow.active : (existing?.active ?? false),
  };
  map[workflow.id] = toSave;
  await writeJsonFile(WORKFLOWS_FILE, map);
  return toSave;
}

export async function createWorkflow(name: string, nodes: Workflow["nodes"] = [], edges: Workflow["edges"] = [], userId?: string, active: boolean = false): Promise<Workflow> {
  const id = `wf-${uuidv4().slice(0, 12)}`;
  const wf: Workflow = {
    id,
    name,
    nodes,
    edges,
    userId,
    active,
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
export async function getAllExecutions(workflowId?: string, userId?: string): Promise<StoredExecution[]> {
  const list = await readJsonFile<StoredExecution[]>(EXECUTIONS_FILE, []);
  let filtered = list;
  if (workflowId) {
    filtered = filtered.filter((e) => e.workflowId === workflowId);
  }
  if (userId) {
    filtered = filtered.filter((e) => !e.userId || e.userId === userId);
  }
  return filtered.sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
}

export async function saveExecution(execution: Omit<StoredExecution, "id"> & { id?: string }, userId?: string): Promise<StoredExecution> {
  const list = await readJsonFile<StoredExecution[]>(EXECUTIONS_FILE, []);
  const full: StoredExecution = {
    ...execution,
    userId: userId || execution.userId,
    id: execution.id || `exec-${uuidv4().slice(0, 12)}`,
  };
  list.unshift(full); // newest first
  // Keep only last 200 per workflow or overall to avoid unbounded growth
  const pruned = list.slice(0, 500);
  await writeJsonFile(EXECUTIONS_FILE, pruned);
  return full;
}

// --- Credentials (stored encrypted at rest) ---
export async function getAllCredentials(userId?: string): Promise<Credential[]> {
  const list = await readJsonFile<Credential[]>(CREDENTIALS_FILE, []);
  let filtered = list;
  if (userId) {
    filtered = filtered.filter((c) => !c.userId || c.userId === userId);
  }
  return filtered.sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));
}

export async function getCredential(id: string, userId?: string): Promise<Credential | null> {
  const list = await readJsonFile<Credential[]>(CREDENTIALS_FILE, []);
  const cred = list.find((c) => c.id === id) ?? null;
  if (cred && userId && cred.userId && cred.userId !== userId) return null;
  return cred;
}

export async function saveCredential(input: Omit<Credential, "id" | "createdAt" | "updatedAt"> & { id?: string; encryptedData?: string; data?: Record<string, any> }, userId?: string): Promise<Credential> {
  const list = await readJsonFile<Credential[]>(CREDENTIALS_FILE, []);
  const now = new Date().toISOString();
  const id = input.id || `cred-${uuidv4().slice(0, 10)}`;

  let encryptedData = input.encryptedData;
  if (!encryptedData && input.data) {
    encryptedData = encryptCredentialData(input.data);
  }
  if (!encryptedData) {
    encryptedData = encryptCredentialData({});
  }

  const existing = list.find((c) => c.id === id);
  const effectiveUserId = userId || (input as any).userId || existing?.userId;
  const toSave: Credential = {
    id,
    name: input.name || "Unnamed Credential",
    type: input.type,
    encryptedData,
    forNodeTypes: input.forNodeTypes || [],
    userId: effectiveUserId,
    createdAt: existing?.createdAt || (input as any).createdAt || now,
    updatedAt: now,
  };

  const filtered = list.filter((c) => c.id !== id);
  filtered.unshift(toSave);
  await writeJsonFile(CREDENTIALS_FILE, filtered);
  return toSave;
}

export async function deleteCredential(id: string, userId?: string): Promise<boolean> {
  const list = await readJsonFile<Credential[]>(CREDENTIALS_FILE, []);
  const idx = list.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  if (userId && list[idx].userId && list[idx].userId !== userId) return false;
  list.splice(idx, 1);
  await writeJsonFile(CREDENTIALS_FILE, list);
  return true;
}

// --- Users (for auth + multi-tenancy) ---
// Stored as array for simplicity (demo)
async function readUsers(): Promise<User & { password: string }[]> {
  const def: (User & { password: string })[] = [];
  return readJsonFile<(User & { password: string })[]>(USERS_FILE, def);
}

async function writeUsers(users: (User & { password: string })[]): Promise<void> {
  await writeJsonFile(USERS_FILE, users);
}

export async function getUserByEmail(email: string): Promise<(User & { password: string }) | null> {
  const users = await readUsers();
  return users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
}

export async function createUser(email: string, password: string, name?: string): Promise<User> {
  const users = await readUsers();
  const existing = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    throw new Error("User already exists");
  }
  const user: User & { password: string } = {
    id: `user-${uuidv4().slice(0, 10)}`,
    email: email.toLowerCase(),
    name: name || email.split("@")[0],
    password, // DEMO ONLY: plaintext. Use bcrypt + salt in real.
  };
  users.push(user);
  await writeUsers(users);
  const { password: _p, ...safe } = user;
  return safe;
}

export async function validateUser(email: string, password: string): Promise<User | null> {
  const u = await getUserByEmail(email);
  if (!u) return null;
  if (u.password !== password) return null; // DEMO: plain compare
  const { password: _p, ...safe } = u;
  return safe;
}

export async function getUserById(id: string): Promise<User | null> {
  const users = await readUsers();
  const u = users.find((x) => x.id === id);
  if (!u) return null;
  const { password: _p, ...safe } = u;
  return safe;
}

// Optional: seed a demo user on first use (for easy testing)
export async function ensureDemoUser(): Promise<User> {
  const demoEmail = "demo@n8nlike.local";
  let u = await getUserByEmail(demoEmail);
  if (!u) {
    // create with easy demo password
    return createUser(demoEmail, "demo", "Demo User");
  }
  const { password: _p, ...safe } = u as any;
  return safe;
}

