export type NodeType =
  | "manualTrigger"
  | "set"
  | "httpRequest"
  | "if"
  | "code"
  | "webhookTrigger"
  | "scheduleTrigger"
  | "aiLlm"
  | "database"
  | "email"
  | "loop"
  | "merge";

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
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface Workflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt?: string;
  updatedAt?: string;
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

// For backend persistence
export interface StoredExecution extends ExecutionResult {
  id: string;
  workflowId: string;
  workflowName?: string;
}

// Simple API response shapes (shared)
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
