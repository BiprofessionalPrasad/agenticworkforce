# n8nlike

A visual, node-based workflow automation tool built as an n8n-inspired project.

## Features (MVP)

- **Drag & drop node canvas** powered by React Flow (`@xyflow/react`)
- Core node types:
  - **Manual Trigger** — start a workflow with seed data
  - **Set** — assign/transform data (supports simple `{{ $json.path }}` expressions)
  - **HTTP Request** — call external APIs
  - **IF** — branch with true/false output ports
  - **Code** — run inline JavaScript
- Real execution engine that runs nodes in order and passes data between them
- Live execution log + final output panel
- Local persistence + Import/Export of workflows as JSON
- Fully client-side (no backend required for MVP)

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000

### Usage

1. Drag nodes from the left palette onto the canvas (or click them)
2. Connect nodes by dragging from the right handle to the left handle of the next node
3. Click a node to edit its parameters on the right panel
4. Click **Execute Workflow**
5. View step-by-step results in the Execution Log

### Example flows

- Trigger → Set (enrich data) → HTTP Request
- Trigger → Set → IF (branch) → different downstream nodes

## Architecture notes

- `lib/types.ts` — core domain types
- `lib/nodes.ts` — node definitions + registry (easy to extend)
- `lib/execution.ts` — the DAG execution engine
- `app/page.tsx` — full visual editor UI

## Next steps ideas

- Backend + database (save workflows remotely)
- Webhook trigger node + scheduling
- Better expression language (`$json`, `$input`, etc.)
- More nodes (email, database, AI, loops, merge, etc.)
- Authentication + multi-workflow management
- Error handling / retries / execution history

Built with Next.js + TypeScript + React Flow.
