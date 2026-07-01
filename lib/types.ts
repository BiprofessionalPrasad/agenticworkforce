export type NodeType =
  | "manualTrigger"
  | "set"
  | "httpRequest"
  | "if"
  | "code"
  | "webhookTrigger"
  | "scheduleTrigger"
  | "formTrigger"
  | "aiLlm"
  | "database"
  | "email"
  | "loop"
  | "merge"
  | "subWorkflow"
  | "telegram"
  | "slack";

/** Auth User (for multi-tenancy) */
export interface User {
  id: string;
  email: string;
  name?: string;
}

/**
 * n8n-like data item. Workflows pass arrays of items between nodes.
 * $json in expressions resolves to item.json .
 */
export interface ExecutionItem {
  json: Record<string, any>;
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: {
    label?: string;
    parameters: Record<string, any>;
  };
  /** For node grouping / nesting (React Flow parent-child) */
  parentNode?: string;
  extent?: "parent";
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface WorkflowVersion {
  version: number;
  name?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  savedAt: string;
}

export interface Workflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
  /** Whether the workflow is active/published for triggers and scheduling (server-side) */
  active?: boolean;
  /** Draft vs Published for versioning feature */
  isPublished?: boolean;
  /** Version history (new) */
  versions?: WorkflowVersion[];
}

export interface NodeExecutionResult {
  nodeId: string;
  nodeType: NodeType;
  /** Array of items received by this node (n8n-style multi-item) */
  input: ExecutionItem[] | any;
  /** Array of items emitted by this node */
  output: ExecutionItem[] | any;
  error?: string | any; // richer: can be object with message/stack
  durationMs?: number;
}

export interface ExecutionResult {
  success: boolean;
  results: NodeExecutionResult[];
  /** Final output is now ExecutionItem[] for consistency with multi-item model */
  finalOutput?: ExecutionItem[];
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface ExecutionRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  workflowSnapshot: {
    name: string;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
  };
  startedAt: string;
  finishedAt?: string;
  success: boolean;
  results: NodeExecutionResult[];
  finalOutput?: ExecutionItem[];
  error?: string;
}

export interface NodeDefinition {
  type: NodeType;
  label: string;
  description: string;
  icon: string; // lucide icon name
  color?: string;
  inputs: number; // 0,1,2+
  outputs: string[]; // e.g. ["main"] or ["true", "false"]
  defaultParameters: Record<string, any>;
}

// Credentials / Connections Management (CRED-001)
// Clean single definitions. data holds decrypted values at runtime (plain for MVP; future: encrypt server-side).
export type CredentialType = "apiKey" | "basicAuth" | "oauth2" | "generic" | "smtp";

export interface Credential {
  id: string;
  name: string;
  type: CredentialType;
  /** Runtime data e.g. { apiKey: "...", username: "...", password: "..." }. 
   *  Note: For production use secure storage (never plain in prod JSON). */
  data?: Record<string, any>;
  encryptedData?: string;
  forNodeTypes?: string[];
  platform?: string; // e.g. "http", "telegram", "openai", "slack"
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Credentials API response shapes (deduped)
export interface CredentialListResponse {
  credentials: Credential[];
}

export interface CredentialResponse {
  credential: Credential;
}

// For backend persistence (single def)
export interface StoredExecution extends ExecutionResult {
  id: string;
  workflowId: string;
  workflowName?: string;
  userId?: string;
  // Optional full snapshot so server execs (schedules, webhooks, forms) support History replay (was missing)
  workflowSnapshot?: {
    name: string;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
  };
}

// Simple shared API response shapes (single canonical def)
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface WorkflowListResponse {
  workflows: Workflow[];
}

export interface ExecutionListResponse {
  executions: StoredExecution[];
}
