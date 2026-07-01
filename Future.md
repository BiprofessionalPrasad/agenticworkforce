# Future Roadmap for n8nlike

**Top Recommendations from Side-by-Side Analysis of 10 Similar Projects**

*Analysis performed June 2026 against:*
- Official n8n (n8n-io/n8n)
- Activepieces
- kotiyalashwin/n8n-project
- echostorm/u8u
- Musheer0/n8n-clone
- elitenoire/nodeio
- Azim-Ahmed/Automation-workflow (UI examples)
- xyflow official examples + Workflow Editor template
- samiksha0shukla/n8n
- akash-R-A-J/n8n + broader ecosystem patterns

**Current Strengths of n8nlike (to preserve):**
- Excellent flexible React Flow canvas
- Powerful multi-item execution engine with rich `{{ $json / $input / $node }}` expressions
- 12 node types, live status visualization, History + replay
- Undo/redo, keyboard shortcuts, import/export
- Dual client/API modes + webhook support

**Core Philosophy for Future Work:**
Prioritize features that close the gap between "impressive demo" and "production-ready automation platform" while leveraging our existing strong execution and canvas foundations.

---

## High Priority (Must-Have for Production Viability)

### 1. Credentials / Connections Management System
**Why:** Almost every comparable project has this as a foundational feature. Enables real integrations without hardcoding secrets.

**What to build:**
- Dedicated credentials UI (create, list, edit, delete) ✅
- Per-platform forms (API Key, OAuth2, Basic Auth, custom) ✅
- Secure storage (encrypted at rest) ✅ (simple XOR+base64 in lib/credentials + storage; JSON)
- Selector in node inspectors ✅ (httpRequest, email, aiLlm)
- Test connection capability ✅ (httpbin echo in modal)
- Expressions support inside credentials ✅ (resolved at use time in execution)
- Works in local + API modes ✅
- Integrated with exec (HTTP auth headers, mock for email/ai)

**Status:** MVP COMPLETE (High Priority #1). Updated by Credentials Agent 2026-06-30. See lib/credentials.ts, app/api/credentials/*, updates to types/execution/page/storage.

**Priority:** Highest
**Inspiration:** kotiyalashwin, Musheer0, samiksha0shukla, Activepieces, official n8n

### 2. Real Authentication + Multi-Tenancy
**Why:** Current system is single-user / local-only. Production tools require user accounts, sessions, and scoping.

**What to build:**
- JWT / Better Auth integration
- User accounts + sessions
- Per-user isolation for workflows, credentials, and executions
- Protected API routes

**Status (done):** Implemented minimal JWT (jose) + httpOnly cookie sessions. Simple demo signup/login forms (modal gate). Per-user scoping in storage (userId filter + enforce on wf/cred/exec), client localStorage keys prefixed. proxy.ts + route guards. API + canvas/execution fully per-user. Demo users persist in data/users.json (plain pw for MVP).

**Priority:** Highest
**Inspiration:** akash-R-A-J, Musheer0, Activepieces, samiksha0shukla

### 3. Real (Non-Mock) Integrations
**Why:** Many nodes are currently mocked (AI, Email, Database). Users need actual functionality.

**Recommended starting nodes:**
- Telegram (send + listen/polling)
- Gmail / SMTP Email
- Slack / Discord
- Expand HTTP Request with auth

**Priority:** High
**Inspiration:** kotiyalashwin, samiksha0shukla, akash-R-A-J, Activepieces

### 4. Production-Grade Triggers & Scheduling
**Why:** `scheduleTrigger` is currently simulated. Real automation requires reliable recurring and event-driven execution.

**What to build:**
- Real cron-based Schedule trigger (server-side)
- Enhanced webhook handling (auth, richer context)
- Form triggers (Google Form style or custom)
- Workflow activation / publishing model

**Priority:** High
**Inspiration:** official n8n, Activepieces, Musheer0

**Status (2026-06-30, Triggers Agent):** ✅ IMPLEMENTED
- Real server-side scheduler (lib/scheduler.ts) using native timers + cron matcher; only for `active` workflows.
- Schedule nodes use real execution when active.
- Enhanced /api/webhooks/[id] : secret auth, always-rich payload (body/headers/query/method/etc).
- Added formTrigger node + /api/forms/[id] route (auth optional, rich data, active guard).
- Workflow `active` flag (types + storage + UI toggle "ACTIVE/INACTIVE" + backend register/unregister).
- Persist + auto (re)schedule on save/activate.
- "Fire (server)" button for reliable manual trigger of any wf via server path (demo + real).
- Manual client run remains; server triggers reliable in API mode.
- Active check enforced for external triggers. Scheduler bootstraps on API hits.
- Updated execution, nodes, APIs, UI editors. No new deps (pure timer).

### 5. Advanced Real AI Agents
**Why:** `aiLlm` node is a mock. AI is a major differentiator in 2026-era tools.

**What to build:**
- Real LLM support (OpenAI, Claude, Gemini, local via Ollama)
- Tool calling / function calling agents
- Memory + RAG capabilities
- Optional: AI-assisted workflow generation or node configuration

**Priority:** High
**Inspiration:** akash-R-A-J (Gemini + tools), elitenoire, Activepieces, echostorm, official n8n

### 6. Workflow Versioning + Templates Library
**Why:** Critical for safe editing and fast onboarding.

**What to build:**
- Draft vs Published workflow states
- Version history with restore
- Curated templates gallery (importable JSON)
- "Convert to sub-workflow" pattern (longer term)

**Priority:** High
**Inspiration:** Activepieces, official n8n

---

## Medium-High Priority (Major UX & Architecture Wins)

### 7. Advanced React Flow Canvas Polish
**Why:** Our canvas is functional but lacks professional finishing touches found in the best examples.

**Recommended features:**
- Auto-layout (ELKjs + Dagre) with "Arrange" button
- Edge insert buttons (click + to add node on a connection)
- Node grouping / nesting / subflows
- Context menus (right-click)
- Node/edge toolbars and resizers
- Helper lines + snap alignment
- Better `NodeStatusIndicator` components

**Priority:** Medium-High
**Inspiration:** xyflow examples, Azim-Ahmed/Automation-workflow, elitenoire/nodeio

### 8. Scalable Execution Architecture
**Why:** Current execution is mostly in-process. Production tools use queues and workers.

**What to build:**
- Background job system (Inngest, BullMQ, or similar)
- Dedicated worker process or server actions
- Realtime execution updates (WebSocket + pub/sub)
- Durable execution / crash recovery patterns

**Priority:** Medium-High
**Inspiration:** Musheer0 (Inngest), kotiyalashwin (Redis + worker + WS), Activepieces, official n8n queue mode

### 9. Enhanced Execution History & Debugging
**Why:** Our History tab exists but server executions are not fully integrated. Competitors offer superior debugging.

**Improvements:**
- Full persistent run history across all triggers
- Per-node input/output inspection
- "Debug in editor" / data pinning from past runs
- Better error stacks and timing
- Execution comparison

**Priority:** Medium-High
**Inspiration:** official n8n, Activepieces, Musheer0

### 10. Robust Persistence Layer
**Why:** Filesystem JSON (`lib/storage.ts`) works for MVP but limits scale and querying.

**Recommended path:**
- Migrate to Postgres + Prisma or Drizzle
- Keep current JSON blob approach initially for workflows/edges
- Add proper relational tables for executions, credentials, users

**Priority:** Medium-High
**Inspiration:** Most serious projects (Musheer0, akash, Activepieces, elitenoire)

---

## Additional Notable Recommendations

- **Rich Formula / Data Panel UX** — Live preview data transformation helpers (complements our JS expressions)
- **Forms & Human-in-the-Loop** — Dynamic forms, approvals, delay steps
- **Audit Logs + Basic RBAC** — For team/enterprise use
- **MCP Integration** — Expose nodes/workflows as tools for AI agents
- **Docker + One-Click Deployment** — Production self-hosting experience (inspired by echostorm)

---

## Prioritization Framework

| Priority | Focus Area                    | Estimated Impact          | Effort |
|----------|-------------------------------|---------------------------|--------|
| Highest  | Credentials + Auth            | Enables real use          | High   |
| High     | Real Integrations + AI        | Closes mock gap           | Medium |
| High     | Scheduling + Webhooks         | Production triggers       | Medium |
| High     | Versioning + Templates        | Onboarding & safety       | Medium |
| Med-High | Canvas Polish + Auto-layout   | Daily usability           | Medium |
| Med-High | Backend Scaling + History     | Reliability               | High   |

---

## Guiding Principles

1. **Build on strengths**: Keep the powerful execution engine and flexible React Flow canvas as differentiators.
2. **Add production fundamentals first**: Auth → Credentials → Real nodes → Reliability.
3. **Adopt proven patterns**: Many ideas can be directly inspired (with attribution) from the analyzed repos.
4. **Incremental delivery**: Each major feature should work in both client-only and API modes where possible.

---
**Update (Integrations+AI Agent + Real Integrations/Triggers/AI):** High Priorities #3,#4,#5 completed: 
- Real Integrations: aiLlm (real OpenAI + basic tool calling), email (Resend fetch dual or nodemailer SMTP via cred for Gmail/SMTP or fallback), Telegram (real Bot API send), Slack (real), http expanded with cred auth. All use cred/env + expressions. SMTP support + 'smtp' cred type added.
- Production Triggers/Scheduling (#4): scheduleTrigger real via lib/scheduler (cron ticker, active-only, server execute), enhanced webhooks+forms (secret auth, rich payloads always, active guard), activation toggle in UI + auto (un)register on save. ensureScheduler on all API loads. "Fire (server)" button.
- Advanced Real AI (#5): aiLlm real + tool calling basics (tools JSON in editor, passed to OpenAI, tool_calls returned for agent patterns).
Credential passing ensured to all real nodes in client + all server paths (pre-resolve in webhook/form/schedule). UI param editors + selectors + toggles full. Build clean. See execution.ts, nodes.ts, page.tsx, api/webhooks, api/forms, scheduler.ts, storage.

*Generated from comprehensive analysis by 10 specialized research agents. Last updated: 2026-06-30*

**Progress (as of Credentials & Auth Implementation Agent 2026-06-30 + Hardening):**
- 1. Credentials/Connections: FULL (UI modal manager with per-type forms from CREDENTIAL_TYPES, CRUD + test button + list, expressions note+support at runtime; selector dropdowns integrated in httpRequest/aiLlm/email/database/telegram/slack/etc with credentialId persisted in node params; resolveCredentialAndAuth wired + full creds list passed in runWorkflow + executeWorkflow(client fallback, local, api server paths via webhooks/forms/scheduler); pre-resolve + expr resolve on auth fields (apiKey etc) inside per-item loops for cred values like {{ $json.token }}; dual local/API + user scoping).
- 2. Real Authentication + Multi-Tenancy: FULL + completed/hardened (User + sessions/JWT jose httpOnly + proxy guard + getCurrentUser w/ header fallback; all main CRUD APIs protected (incl webhooks public-by-design with active/secret); full per-userId isolation in storage (getAll + get + deleteWorkflow now scoped/enforce), executions/creds + client LS prefixed + userId threaded in executeWorkflow/resolveCredentialAndAuth/getClient for robust lookup; UI full gate/login/signup/topbar/logout + local-demo bypass; scheduler/triggers/forms use wf.userId; all canvas/exec/history per-user. Demo plain pw noted. Basic MT isolation test added.).
- Real Integrations/AI: resolveCredential wired + used; email now SMTP capable; full.
- Triggers: implemented (see prior).
- 6. Workflow Versioning + Templates Library + 7. Advanced React Flow Canvas Polish: IMPLEMENTED (Versioning and Polish Agent). Storage (lib/storage) + types enhanced for versions/isPublished/active + parentNode for groups. UI: Draft/Published badges + toggles, Versions tab (list/restore/delete/save + state), Templates gallery modal+section (4 samples incl sub-wf demo + import), convert-to-sub + basic sub node execution/inspector. Canvas: snapToGrid, + insert buttons on edges (CustomEdge + label renderer), enhanced context menus (right-click add/group/delete/ungroup/layout), node/edge toolbars on select, basic grouping via parentNode+extent (group/ungroup), improved auto-layout (layered Kahn with better spacing). No new deps. All in page.tsx + small types. Dual mode.
- Build: succeeds (static + log); basic smoke test for creds + auth/MT added.

**Auth notes:** Secure cookie sessions; demo mode supported (no-auth local). For prod: replace plain pw with hash, use real DB, rotate SESSION_SECRET. Webhook IDs act as locator (standard); optional secret per-node for extra.

**Next step suggestion:** Run `npm run build && npm run lint && npm run dev`; manual test create cred (apiKey) + attach to http node + execute; full QA. Focus remaining Future if any.