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
    description: "Make an HTTP call (real, with auth via credential or params: apiKey, basic, oauth)",
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
      // credentialId supported for auth
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
    description: "Cron / interval trigger (real server-side when active)",
    icon: "Timer",
    color: "#6366f1",
    inputs: 0,
    outputs: ["main"],
    defaultParameters: {
      schedule: "*/5 * * * *",
      interval: "5m",
      description: "Real cron when workflow is active + saved to server",
    },
  },
  formTrigger: {
    type: "formTrigger",
    label: "Form Trigger",
    description: "Custom form / HTTP form submit trigger",
    icon: "FileText",
    color: "#14b8a6",
    inputs: 0,
    outputs: ["main"],
    defaultParameters: {
      fields: ["name", "email", "message"],
      description: "Accepts POSTed form data at /api/forms/{workflowId}",
      requireAuth: false,
    },
  },
  aiLlm: {
    type: "aiLlm",
    label: "AI / LLM",
    description: "Real LLM call (OpenAI + basic tool calling + expr). Uses credential or OPENAI_API_KEY",
    icon: "Bot",
    color: "#a855f7",
    inputs: 1,
    outputs: ["main"],
    defaultParameters: {
      prompt: "Analyze the input and return a short summary plus a sentiment score between -1 and 1.",
      model: "gpt-4o-mini",
      temperature: 0.7,
      // tools: [...] for basic tool calling (see editor)
      // credentialId: "cred_xxx" or apiKey inline for direct
    },
  },
  database: {
    type: "database",
    label: "Database",
    description: "Key/value store (localStorage client / memory; supports expr + credential for future DBs)",
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
    description: "Send real email (Resend API if key/credential; else logs). Supports expressions + credentialId",
    icon: "Mail",
    color: "#ef4444",
    inputs: 1,
    outputs: ["main"],
    defaultParameters: {
      to: "recipient@example.com",
      from: "onboarding@resend.dev",
      subject: "Workflow notification",
      body: "Hello, here is the data: {{ $json }}",
      // apiKey or credentialId (use "apiKey" or "generic" type)
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
  subWorkflow: {
    type: "subWorkflow",
    label: "Sub-workflow",
    description: "Run another workflow (basic reference)",
    icon: "GitBranch",
    color: "#64748b",
    inputs: 1,
    outputs: ["main"],
    defaultParameters: {
      workflowId: "", // reference to another wf id
      note: "Basic subflow: input passed through; ref only",
    },
  },
  telegram: {
    type: "telegram",
    label: "Telegram",
    description: "Send Telegram message (real via Bot API; supports credentialId or botToken)",
    icon: "Send",
    color: "#229ED9",
    inputs: 1,
    outputs: ["main"],
    defaultParameters: {
      chatId: "{{ $json.chatId || '' }}",
      text: "Workflow update: {{ $json }}",
      // botToken via param or credential (apiKey type), or TELEGRAM_BOT_TOKEN env
    },
  },
  slack: {
    type: "slack",
    label: "Slack",
    description: "Send Slack message (webhook URL or token; credential supported)",
    icon: "MessageSquare",
    color: "#E01E5A",
    inputs: 1,
    outputs: ["main"],
    defaultParameters: {
      channel: "#general",
      text: "n8nlike: {{ $json.message || 'update' }}",
      // webhookUrl or apiToken via credential
    },
  },
};

export function getNodeDefinition(type: NodeType): NodeDefinition {
  return nodeDefinitions[type];
}

export const nodeTypesList = Object.values(nodeDefinitions);
