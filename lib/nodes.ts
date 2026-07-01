import { NodeDefinition, NodeType } from "./types";

export const nodeDefinitions: Record<NodeType, NodeDefinition> = {
  manualTrigger: {
    type: "manualTrigger",
    label: "Manual Trigger",
    description: "Starts the workflow manually",
    icon: "Play",
    color: "#22c55e",
    inputs: 0,
    outputs: ["main"],
    defaultParameters: {
      seedData: { message: "Hello from n8nlike!" },
    },
  },
  set: {
    type: "set",
    label: "Set",
    description: "Set or transform data",
    icon: "Edit3",
    color: "#eab308",
    inputs: 1,
    outputs: ["main"],
    defaultParameters: {
      // Simple key-value assignments. Supports {{ $json.key }} later
      assignments: [
        { key: "status", value: "processed" },
      ],
    },
  },
  httpRequest: {
    type: "httpRequest",
    label: "HTTP Request",
    description: "Make an HTTP call",
    icon: "Globe",
    color: "#3b82f6",
    inputs: 1,
    outputs: ["main"],
    defaultParameters: {
      method: "GET",
      url: "https://jsonplaceholder.typicode.com/todos/1",
      headers: {},
      body: null,
      timeoutMs: 10000,
      // Engine supports: retries: 2, continueOnFail: true
    },
  },
  if: {
    type: "if",
    label: "IF",
    description: "Route based on condition",
    icon: "GitBranch",
    color: "#8b5cf6",
    inputs: 1,
    outputs: ["true", "false"],
    defaultParameters: {
      // Very simple conditions for MVP: field, operator, value
      left: "data.status", // dot path or literal
      operator: "equals",
      right: "processed",
    },
  },
  code: {
    type: "code",
    label: "Code",
    description: "Run JavaScript (browser context)",
    icon: "Code2",
    color: "#f97316",
    inputs: 1,
    outputs: ["main"],
    defaultParameters: {
      // The JS code. Receives input as 'input', must return a value
      code: "return { ...input, processedAt: new Date().toISOString() };",
    },
  },
  webhookTrigger: {
    type: "webhookTrigger",
    label: "Webhook Trigger",
    description: "Simulate incoming webhook payload",
    icon: "Webhook",
    color: "#10b981",
    inputs: 0,
    outputs: ["main"],
    defaultParameters: {
      testPayload: { event: "user.created", user: { id: 42, name: "Test User" }, ts: "{{now}}" },
    },
  },
  scheduleTrigger: {
    type: "scheduleTrigger",
    label: "Schedule Trigger",
    description: "Cron / interval trigger (simulated)",
    icon: "Timer",
    color: "#6366f1",
    inputs: 0,
    outputs: ["main"],
    defaultParameters: {
      schedule: "*/5 * * * *",
      interval: "5m",
      description: "Runs every 5 minutes (simulated on execute)",
    },
  },
  aiLlm: {
    type: "aiLlm",
    label: "AI / LLM",
    description: "Mock AI / LLM call with prompt",
    icon: "Bot",
    color: "#a855f7",
    inputs: 1,
    outputs: ["main"],
    defaultParameters: {
      prompt: "Analyze the input and return a short summary plus a sentiment score between -1 and 1.",
      model: "mock-llm-v1",
      temperature: 0.7,
    },
  },
  database: {
    type: "database",
    label: "Database",
    description: "Key/value store (localStorage)",
    icon: "Database",
    color: "#14b8a6",
    inputs: 1,
    outputs: ["main"],
    defaultParameters: {
      operation: "get", // get | set | query
      key: "myKey",
      value: { example: "data" },
    },
  },
  email: {
    type: "email",
    label: "Email",
    description: "Send mock email (logs it)",
    icon: "Mail",
    color: "#ef4444",
    inputs: 1,
    outputs: ["main"],
    defaultParameters: {
      to: "recipient@example.com",
      subject: "Workflow notification",
      body: "Hello, here is the data: {{ $json }}",
    },
  },
  loop: {
    type: "loop",
    label: "Loop",
    description: "Repeat sub-flow N times (iterates downstream)",
    icon: "Repeat",
    color: "#f59e0b",
    inputs: 1,
    outputs: ["main"],
    defaultParameters: {
      iterations: 3,
      mode: "count", // count or while (while limited)
    },
  },
  merge: {
    type: "merge",
    label: "Merge",
    description: "Combine multiple incoming branches",
    icon: "Merge",
    color: "#06b6d4",
    inputs: 2,
    outputs: ["main"],
    defaultParameters: {
      strategy: "combine", // combine | array | firstNonNull
    },
  },
};

export function getNodeDefinition(type: NodeType): NodeDefinition {
  return nodeDefinitions[type];
}

export const nodeTypesList = Object.values(nodeDefinitions);
