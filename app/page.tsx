"use client";

import React, { useCallback, useState, useMemo, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  NodeTypes,
  EdgeTypes,
  Handle,
  Position,
  ReactFlowProvider,
  useOnSelectionChange,
  Panel,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  EdgeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Play, Save, Trash2, Plus, Download, Upload, RefreshCw, History, Clock, RotateCcw, X, ChevronDown, ChevronUp, Server, HardDrive, Webhook, Timer, Bot, Database, Mail, Repeat, Merge, Pencil, Code, Info, Loader, CircleCheck, CircleX, Search, Maximize2, LayoutDashboard, Circle, Undo2, Redo2, Globe, GitBranch, Key, FileText, ToggleLeft, ToggleRight, Power, Send, MessageSquare, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import dynamic from "next/dynamic";

import { Workflow, WorkflowNode, WorkflowEdge, ExecutionResult, NodeType, ExecutionRecord, Credential, CredentialType, WorkflowVersion, User } from "../lib/types";
import { nodeDefinitions, nodeTypesList, getNodeDefinition } from "../lib/nodes";
import { executeWorkflow } from "../lib/execution";
import type { ExecutionItem } from "../lib/types";
import {
  saveExecution,
  listExecutions,
  getExecution,
  clearExecutions,
  deleteExecution,
} from "../lib/executions";
import {
  listClientCredentials,
  saveClientCredential,
  deleteClientCredential,
  getDecryptedData,
  CREDENTIAL_TYPES,
  encryptCredentialData,
  getCredentialTypeDef,
} from "../lib/credentials";

const defaultWorkflow: Workflow = {
  id: "wf-1",
  name: "My Workflow",
  nodes: [],
  edges: [],
  active: false,
  isPublished: false,
  versions: [],
};

function N8nlike() {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const [workflow, setWorkflow] = useState<Workflow>(defaultWorkflow);
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<WorkflowEdge>([]);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [execution, setExecution] = useState<ExecutionResult | null>(null);

  // Execution history state
  const [executions, setExecutions] = useState<ExecutionRecord[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<"inspector" | "logs" | "history" | "versions" | "credentials">("inspector");

  // Collapsible state for live execution log steps
  const [expandedLiveSteps, setExpandedLiveSteps] = useState<Set<number>>(new Set());

  // API mode: when true, use backend API + persistent storage; fallback to localStorage when false or on error
  const [useApi, setUseApi] = useState<boolean>(true);
  const [workflowsList, setWorkflowsList] = useState<Workflow[]>([]);
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(false);
  const [isApiOperation, setIsApiOperation] = useState(false);

  // Early normalize for compat (versions, published/active for triggers) used by loads
  const normalizeWorkflow = (wf: any): Workflow => ({
    ...(wf || {}),
    id: (wf && wf.id) || `wf-${Date.now()}`,
    name: (wf && wf.name) || "Untitled",
    nodes: (wf && Array.isArray(wf.nodes)) ? (wf.nodes as any[]).map((n:any) => ({...n, parentNode: n.parentNode, extent: n.extent})) : [],
    edges: (wf && Array.isArray(wf.edges)) ? wf.edges : [],
    isPublished: typeof (wf && wf.isPublished) === "boolean" ? wf.isPublished : false,
    active: typeof (wf && wf.active) === "boolean" ? wf.active : (typeof (wf && wf.isPublished) === "boolean" ? wf.isPublished : false),
    versions: Array.isArray(wf && wf.versions) ? wf.versions : [],
  });

  // Credentials state (supports local + API modes)
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [isLoadingCredentials, setIsLoadingCredentials] = useState(false);
  const [showCredManager, setShowCredManager] = useState(false);
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  // Context menu stub (Future #7 polish)
  const [contextMenu, setContextMenu] = useState<null | { x: number; y: number; nodeId?: string; edgeId?: string }>(null);
  const [editingCredId, setEditingCredId] = useState<string | null>(null);
  const [credForm, setCredForm] = useState<{ name: string; type: CredentialType; data: Record<string, any> }>({
    name: "",
    type: "apiKey",
    data: {},
  });
  const [credTestResult, setCredTestResult] = useState<string | null>(null);

  // --- Auth + Multi-tenancy (High Priority #2) ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthOp, setIsAuthOp] = useState(false);

  // --- API helpers (for useApi mode)  -- defined early to be usable in effects ---
  const apiFetch = async (url: string, options?: RequestInit) => {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
      ...options,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      throw new Error(json.error || `Request failed: ${res.status}`);
    }
    return json.data;
  };

  // --- Auth helpers (JWT cookie based, per-user isolation) ---
  const fetchCurrentUser = async (): Promise<User | null> => {
    try {
      const data = await apiFetch("/api/auth/me");
      return data?.user || null;
    } catch {
      return null;
    }
  };

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsAuthOp(true);
    setAuthError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail, password: authPassword }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Login failed");
      setCurrentUser(json.data.user);
      setShowAuth(false);
      setAuthPassword("");
      toast.success("Logged in as " + json.data.user.email);
      // reload data for this user
      await reloadDataForUser(json.data.user);
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setIsAuthOp(false);
    }
  };

  const handleSignup = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsAuthOp(true);
    setAuthError(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail, password: authPassword, name: authName || undefined }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Signup failed");
      setCurrentUser(json.data.user);
      setShowAuth(false);
      setAuthPassword("");
      setAuthName("");
      toast.success("Account created. Welcome!");
      await reloadDataForUser(json.data.user);
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setIsAuthOp(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    setCurrentUser(null);
    setWorkflow(defaultWorkflow);
    setNodes([]);
    setEdges([]);
    setExecutions([]);
    setWorkflowsList([]);
    // clear local keys for safety
    try {
      localStorage.removeItem(currentUser ? `n8nlike-workflow-${currentUser.id}` : "n8nlike-workflow");
      localStorage.removeItem(currentUser ? `n8nlike-executions-${currentUser.id}` : "n8nlike-executions");
      localStorage.removeItem(currentUser ? `n8nlike-credentials-${currentUser.id}` : "n8nlike-credentials");
    } catch {}
    toast.info("Logged out");
  };

  const reloadDataForUser = async (user: User) => {
    // After login, (re)load workflows/creds/history for this user (API preferred)
    setIsLoadingWorkflows(true);
    try {
      if (useApi) {
        const list = await loadWorkflowsFromApi();
        if (list.length > 0) {
          const mostRecent = list[0];
          setWorkflow(mostRecent);
          setNodes(mostRecent.nodes || []);
          setEdges(mostRecent.edges || []);
        } else {
          await createNewWorkflowViaApi();
        }
        const creds = await loadCredentialsFromApi();
        setCredentials(creds || []);
      }
      // load client history (will be prefixed later)
      const hist = listExecutions(user?.id);
      setExecutions(hist);
      if (useApi) {
        const serverHist = await loadExecutionsFromApi();
        if (serverHist.length) setExecutions((prev) => {
          const ids = new Set(prev.map((p:any)=>p.id));
          const merged = [...serverHist.filter((s:any)=>!ids.has(s.id)), ...prev];
          return merged.slice(0,50);
        });
      }
    } catch (e) {
      // fallback handled inside
    } finally {
      setIsLoadingWorkflows(false);
    }
  };

  // Initial auth check on mount (after helpers defined to avoid TDZ): restore session or show gate.
  // Sets loading false so UI can render login or main. Supports no-auth local demo bypass.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const u = await fetchCurrentUser();
        if (active && u) {
          setCurrentUser(u);
        }
      } catch {}
      if (active) setIsAuthLoading(false);
    })();
    return () => { active = false; };
  }, []);


  const loadWorkflowsFromApi = async () => {
    setIsLoadingWorkflows(true);
    try {
      const data = await apiFetch("/api/workflows");
      const list: Workflow[] = (data?.workflows || []).map(normalizeWorkflow);
      setWorkflowsList(list);
      return list;
    } catch (e: any) {
      toast.error("API load failed, falling back to local: " + e.message);
      setUseApi(false);
      return [];
    } finally {
      setIsLoadingWorkflows(false);
    }
  };

  const loadWorkflowByIdFromApi = async (id: string) => {
    setIsApiOperation(true);
    try {
      const wfRaw = await apiFetch(`/api/workflows/${encodeURIComponent(id)}`);
      const wf = wfRaw ? normalizeWorkflow(wfRaw) : null;
      if (wf) {
        const norm = normalizeWorkflow(wf);
        setWorkflow(norm);
        setNodes(norm.nodes || []);
        setEdges(norm.edges || []);
        setSelectedNodeId(null);
        setExecution(null);
        setSelectedHistoryId(null);
        toast.success(`Loaded workflow from API: ${norm.name}`);
      }
    } catch (e: any) {
      toast.error("Failed to load from API: " + e.message);
    } finally {
      setIsApiOperation(false);
    }
  };

  const saveWorkflowToApi = async () => {
    const current = { ...workflow, nodes: nodes as WorkflowNode[], edges: edges as WorkflowEdge[], isPublished: workflow.isPublished, versions: workflow.versions };
    setIsApiOperation(true);
    try {
      let saved: Workflow;
      // Prefer update if it has a server-style id
      if (current.id && (current.id.startsWith("wf-") || workflowsList.some((w) => w.id === current.id))) {
        try {
          saved = await apiFetch(`/api/workflows/${encodeURIComponent(current.id)}`, {
            method: "PUT",
            body: JSON.stringify(current),
          });
        } catch (putErr: any) {
          if (putErr.message?.includes("404") || putErr.message?.includes("not found")) {
            saved = await apiFetch("/api/workflows", { method: "POST", body: JSON.stringify(current) });
          } else throw putErr;
        }
      } else {
        saved = await apiFetch("/api/workflows", {
          method: "POST",
          body: JSON.stringify(current),
        });
      }
      setWorkflow(saved);
      await loadWorkflowsFromApi();
      toast.success("Saved to API");
      return saved;
    } catch (e: any) {
      toast.error("API save failed: " + e.message + " (using local)");
      setUseApi(false);
      localStorage.setItem(currentUser ? `n8nlike-workflow-${currentUser.id}` : "n8nlike-workflow", JSON.stringify(current));
      return current;
    } finally {
      setIsApiOperation(false);
    }
  };

  const createNewWorkflowViaApi = async () => {
    setIsApiOperation(true);
    try {
      // seed starter also in API mode for MED-003 parity with local
      const starterNodes: WorkflowNode[] = [
        { id: "start-1", type: "manualTrigger", position: { x: 80, y: 180 }, data: { label: "Start", parameters: { seedData: { userId: 123, action: "signup", now: new Date().toISOString() } } } },
        { id: "set-1", type: "set", position: { x: 340, y: 180 }, data: { label: "Enrich Data", parameters: { assignments: [ { key: "status", value: "active" }, { key: "timestamp", value: "{{ $json.now }}" } ] } } },
      ];
      const starterEdges: WorkflowEdge[] = [ { id: "e1", source: "start-1", target: "set-1", sourceHandle: "main", targetHandle: "in" } ];
      const created = await apiFetch("/api/workflows", {
        method: "POST",
        body: JSON.stringify({ name: "Starter Workflow", nodes: starterNodes, edges: starterEdges, isPublished: false }),
      });
      const norm = normalizeWorkflow(created);
      setWorkflow(norm);
      setNodes(norm.nodes || []);
      setEdges(norm.edges || []);
      setSelectedNodeId(null);
      setExecution(null);
      setSelectedHistoryId(null);
      await loadWorkflowsFromApi();
      toast.success("Created new workflow via API (with starter)");
    } catch (e: any) {
      toast.error("Create via API failed: " + e.message);
      const empty: Workflow = { id: `wf-${Date.now()}`, name: "New Workflow", nodes: [], edges: [], isPublished: false, versions: [] };
      setWorkflow(normalizeWorkflow(empty));
      setNodes([]);
      setEdges([]);
    } finally {
      setIsApiOperation(false);
    }
  };

  const deleteCurrentWorkflowViaApi = async () => {
    if (!workflow.id) return;
    if (!confirm(`Delete workflow "${workflow.name}" from server?`)) return;
    setIsApiOperation(true);
    try {
      await apiFetch(`/api/workflows/${encodeURIComponent(workflow.id)}`, { method: "DELETE" });
      const freshList = await loadWorkflowsFromApi();
      const remaining = freshList.filter((w) => w.id !== workflow.id);
      if (remaining.length > 0) {
        await loadWorkflowByIdFromApi(remaining[0].id);
      } else {
        await createNewWorkflowViaApi();
      }
      toast.success("Deleted from API");
    } catch (e: any) {
      toast.error("Delete failed: " + e.message);
    } finally {
      setIsApiOperation(false);
    }
  };

  // --- Credentials API / client helpers (local + API modes) ---
  const loadCredentialsFromApi = async (): Promise<Credential[]> => {
    setIsLoadingCredentials(true);
    try {
      const data = await apiFetch("/api/credentials");
      const list: Credential[] = data?.credentials || [];
      setCredentials(list);
      return list;
    } catch (e: any) {
      // fallback to client list
      const local = listClientCredentials(currentUser?.id);
      setCredentials(local);
      return local;
    } finally {
      setIsLoadingCredentials(false);
    }
  };

  const loadClientCredentials = () => {
    const list = listClientCredentials(currentUser?.id);
    setCredentials(list);
    return list;
  };

  // Executions API integration (HIGH-001/HIGH-003) - mirror server for visibility, keep client snapshots for replay
  const loadExecutionsFromApi = async (workflowId?: string) => {
    try {
      const q = workflowId ? `?workflowId=${encodeURIComponent(workflowId)}` : "";
      const data = await apiFetch(`/api/executions${q}`);
      const serverList: any[] = data?.executions || [];
      return serverList.map((e) => ({
        ...e,
        workflowSnapshot: e.workflowSnapshot || { name: e.workflowName || "Server Exec", nodes: [], edges: [] },
      }));
    } catch {
      return [];
    }
  };

  const saveExecutionToApi = async (result: any, currentWf: Workflow) => {
    if (!useApi) return;
    try {
      await apiFetch("/api/executions", {
        method: "POST",
        body: JSON.stringify({
          workflowId: currentWf.id,
          workflowName: currentWf.name,
          success: !!result.success,
          results: result.results || [],
          finalOutput: result.finalOutput,
          error: result.error,
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          workflowSnapshot: { name: currentWf.name, nodes: currentWf.nodes || [], edges: currentWf.edges || [] },
        }),
      });
    } catch {}
  };

  const saveCredentialToStore = async (plainData: Record<string, any>, meta: { id?: string; name: string; type: CredentialType }) => {
    const enc = encryptCredentialData(plainData);
    setIsApiOperation(true);
    try {
      if (useApi) {
        const payload: any = { name: meta.name, type: meta.type, encryptedData: enc };
        if (meta.id) payload.id = meta.id;
        const res = meta.id
          ? await apiFetch(`/api/credentials/${encodeURIComponent(meta.id)}`, { method: "PUT", body: JSON.stringify(payload) })
          : await apiFetch("/api/credentials", { method: "POST", body: JSON.stringify(payload) });
        await loadCredentialsFromApi();
        return res?.credential;
      } else {
        const saved = saveClientCredential({ id: meta.id, name: meta.name, type: meta.type, encryptedData: enc } as any, currentUser?.id);
        setCredentials((prev) => {
          const without = prev.filter((c) => c.id !== saved.id);
          return [saved, ...without];
        });
        return saved;
      }
    } catch (e: any) {
      toast.error("Failed to save credential: " + e.message + " (local fallback)");
      setUseApi(false);
      const saved = saveClientCredential({ id: meta.id, name: meta.name, type: meta.type, encryptedData: enc } as any, currentUser?.id);
      setCredentials((prev) => {
        const without = prev.filter((c) => c.id !== saved.id);
        return [saved, ...without];
      });
      return saved;
    } finally {
      setIsApiOperation(false);
    }
  };

  const deleteCredentialFromStore = async (id: string) => {
    setIsApiOperation(true);
    try {
      if (useApi) {
        await apiFetch(`/api/credentials/${encodeURIComponent(id)}`, { method: "DELETE" });
        await loadCredentialsFromApi();
      } else {
        deleteClientCredential(id, currentUser?.id);
        setCredentials((prev) => prev.filter((c) => c.id !== id));
      }
      toast.success("Credential deleted");
      // If a node was using it, clear references? (soft; user can reselect)
    } catch (e: any) {
      toast.error("Delete credential failed: " + e.message);
      // still try local
      deleteClientCredential(id, currentUser?.id);
      setCredentials((prev) => prev.filter((c) => c.id !== id));
    } finally {
      setIsApiOperation(false);
    }
  };

  // Load creds on mount or when toggling api
  useEffect(() => {
    if (isClient) {
      if (useApi) {
        loadCredentialsFromApi();
      } else {
        loadClientCredentials();
      }
    }
  }, [useApi, isClient]);

  // Task 5 polish states
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, 'running' | 'success' | 'error'>>({});
  const [outputPreviews, setOutputPreviews] = useState<Record<string, string>>({});
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [historyStack, setHistoryStack] = useState<Array<{ nodes: WorkflowNode[]; edges: WorkflowEdge[] }>>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [paletteFilter, setPaletteFilter] = useState<string>("");
  const [rfInstance, setRfInstance] = useState<any>(null);

  // Icon map for lucide based on string in NodeDefinition (supports new node types)
  const iconMap: Record<string, React.ComponentType<any>> = {
    Play,
    Edit3: Pencil,
    Globe,
    GitBranch,
    Code2: Code,
    Webhook,
    Timer,
    Bot,
    Database,
    Mail,
    Repeat,
    Merge,
    Send,
    MessageSquare,
    FileText,
    Key,
    default: Info,
  };

  // Enhanced CustomNode inside component so it can close over runtime state for status/preview
  const CustomNode = useCallback(({ id, data, type, selected }: { id: string; data: any; type: string; selected?: boolean }) => {
    const def = getNodeDefinition(type as NodeType);
    const label = data.label || def.label;
    const IconComp = iconMap[def.icon] || iconMap.default;

    const hasInput = def.inputs > 0;
    const outPorts = def.outputs;

    const status = nodeStatuses[id];
    const preview = outputPreviews[id];

    // Status badge classes
    const statusClass = status === "running" ? "executing" : status === "success" ? "node-success" : status === "error" ? "node-error" : "";

    return (
      <div
        className={`relative w-[220px] overflow-hidden rounded-lg border text-sm shadow transition-all ${selected ? "border-[#ff6d5a] ring-1 ring-[#ff6d5a]/30" : "border-[#2a2f38]"} ${statusClass} bg-[#16181f]`}
      >
        {/* Better node indicator (always-visible status dot for Future #7) */}
        <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full border-[1.5px] border-[#0f1115] z-10" style={{ background: status === "success" ? "#22c55e" : status === "error" ? "#ef4444" : status === "running" ? "#f59e0b" : "#475569" }} title={status ? status : "idle"} />
        <div
          className="node-header"
          style={{
            borderLeft: `3px solid ${def.color || "#64748b"}`,
            background: `${def.color}15`,
          }}
        >
          <IconComp className="w-3.5 h-3.5" style={{ color: def.color }} />
          <span className="font-medium truncate">{label}</span>
          <span className="ml-auto text-[9px] text-[#8a909c] opacity-70">{type}</span>
          {status && (
            <span className={`ml-1 inline-flex items-center px-1 py-0 rounded text-[9px] ${status === "success" ? "bg-emerald-500/20 text-emerald-400" : status === "error" ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"}`}>
              {status === "running" && <Loader className="w-2.5 h-2.5 animate-spin" />}
              {status === "success" && <CircleCheck className="w-2.5 h-2.5" />}
              {status === "error" && <CircleX className="w-2.5 h-2.5" />}
            </span>
          )}
        </div>

        <div className="node-body text-[#c5c9d0]">
          {type === "manualTrigger" && (
            <div className="text-xs">Starts workflow. Seed data configurable →</div>
          )}
          {type === "set" && (
            <div className="text-xs">
              Sets: {(data.parameters?.assignments || []).map((a: any) => a.key).join(", ") || "(empty)"}
            </div>
          )}
          {type === "httpRequest" && (
            <div className="text-xs truncate">
              {(data.parameters?.method || "GET")} {data.parameters?.url || "https://..."}
            </div>
          )}
          {type === "if" && (
            <div className="text-xs space-y-0.5">
              <div>If {data.parameters?.left} {data.parameters?.operator} {String(data.parameters?.right)}</div>
              <div className="flex gap-4 text-[10px] text-[#5c8df6]">
                <span>true →</span><span>false →</span>
              </div>
            </div>
          )}
          {type === "code" && (
            <div className="font-mono text-[10px] text-[#8a909c] line-clamp-2">
              {data.parameters?.code?.slice(0, 60) || "return input;"}
            </div>
          )}
          {type === "webhookTrigger" && (
            <div className="text-xs">Payload: {JSON.stringify(data.parameters?.testPayload || {}).slice(0, 50)}...</div>
          )}
          {type === "scheduleTrigger" && (
            <div className="text-xs">Schedule: {data.parameters?.schedule || data.parameters?.interval || "cron"}</div>
          )}
          {type === "formTrigger" && (
            <div className="text-xs">Form: {(data.parameters?.fields || []).join(", ") || "custom form"}</div>
          )}
          {type === "aiLlm" && (
            <div className="text-xs truncate">Prompt: {(data.parameters?.prompt || "").slice(0, 45)}...</div>
          )}
          {type === "database" && (
            <div className="text-xs">Op: {data.parameters?.operation || "get"} key: {data.parameters?.key || ""}</div>
          )}
          {type === "email" && (
            <div className="text-xs truncate">To: {data.parameters?.to || ""} | {data.parameters?.subject || ""}</div>
          )}
          {type === "loop" && (
            <div className="text-xs">Repeat {data.parameters?.iterations || 3}× ({data.parameters?.mode || "count"})</div>
          )}
          {type === "merge" && (
            <div className="text-xs">Merge strategy: {data.parameters?.strategy || "combine"}</div>
          )}
          {type === "telegram" && (
            <div className="text-xs truncate">TG → {data.parameters?.chatId || "?"} : {(data.parameters?.text || "").slice(0, 30)}</div>
          )}
          {type === "slack" && (
            <div className="text-xs truncate">Slack {data.parameters?.channel || "#general"}: {(data.parameters?.text || "").slice(0, 25)}</div>
          )}

          {/* data preview badge after execution */}
          {preview && (
            <div className="mt-1 text-[9px] font-mono bg-[#0a0c10]/70 border border-[#2a2f38] rounded px-1 py-0.5 truncate" title={preview}>
              ↳ {preview}
            </div>
          )}
        </div>

        {/* Input handle + label */}
        {hasInput && (
          <div className="relative">
            <Handle
              type="target"
              position={Position.Left}
              id="in"
              className="!bg-[#5c8df6] !border-[#0f1115] !w-3 !h-3"
              style={{ left: -6 }}
            />
            <div className="absolute text-[7px] text-[#8a909c] left-1 top-1/2 -translate-y-1/2 pointer-events-none select-none">main</div>
          </div>
        )}

        {/* Output handle(s) with labels */}
        {outPorts.map((port: string, index: number) => {
          const isMultiple = outPorts.length > 1;
          const yOffset = isMultiple ? (index === 0 ? -10 : 10) : 0;
          const isTrue = port === "true";
          const isFalse = port === "false";
          const handleColor = isTrue ? "#22c55e" : isFalse ? "#ef4444" : "#ff6d5a";
          return (
            <div key={port} className="relative" style={{ position: "absolute", right: -6, top: isMultiple ? `calc(50% + ${yOffset}px)` : "50%" }}>
              <Handle
                type="source"
                position={Position.Right}
                id={port}
                className="!border-[#0f1115] !w-3 !h-3"
                style={{ background: handleColor }}
              />
              {port !== "main" && (
                <div
                  className="absolute text-[7px] font-semibold pointer-events-none select-none whitespace-nowrap"
                  style={{
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: isTrue ? "#22c55e" : isFalse ? "#ef4444" : "#8a909c",
                  }}
                >
                  {port}
                </div>
              )}
              {port === "main" && (
                <div className="absolute text-[7px] text-[#8a909c] right-1 top-1/2 -translate-y-1/2 pointer-events-none select-none">main</div>
              )}
            </div>
          );
        })}
      </div>
    );
  }, [nodeStatuses, outputPreviews]);

  const nodeTypes: NodeTypes = useMemo(
    () => ({
      manualTrigger: CustomNode,
      set: CustomNode,
      httpRequest: CustomNode,
      if: CustomNode,
      code: CustomNode,
      webhookTrigger: CustomNode,
      scheduleTrigger: CustomNode,
      aiLlm: CustomNode,
      database: CustomNode,
      email: CustomNode,
      loop: CustomNode,
      merge: CustomNode,
      telegram: CustomNode,
      slack: CustomNode,
      subWorkflow: CustomNode,
      formTrigger: CustomNode,
    }),
    [CustomNode]
  );

  // Sync workflow <-> flow state
  const syncFromFlow = useCallback((nds: any[], eds: any[]) => {
    setWorkflow((prev) => ({
      ...prev,
      nodes: nds as WorkflowNode[],
      edges: eds as WorkflowEdge[],
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  // Keep workflow in sync whenever nodes or edges change
  useEffect(() => {
    syncFromFlow(nodes, edges);
  }, [nodes, edges, syncFromFlow]);

  // Load preference + workflows or local on mount (guarded by auth)
  useEffect(() => {
    if (!currentUser) return;
    const savedMode = localStorage.getItem("n8nlike-use-api");
    const initialApi = savedMode === null ? true : savedMode === "true";
    setUseApi(initialApi);

    const loadInitial = async () => {
      // Load client history always
      const hist = listExecutions(currentUser?.id);
      setExecutions(hist);

      // Load credentials (CRED)
      await loadCredentialsFromApi();

      if (initialApi) {
        const list = await loadWorkflowsFromApi();  // may flip useApi on fail
        if (list.length > 0) {
          // auto load most recent
          const mostRecent = normalizeWorkflow(list[0]);
          setWorkflow(mostRecent);
          setNodes(mostRecent.nodes || []);
          setEdges(mostRecent.edges || []);
          toast.success("Loaded latest workflow from API");
        } else {
          // create default on server
          await createNewWorkflowViaApi();
        }
        // Merge server executions (from webhooks/schedules/forms) so History tab shows them (HIGH integration gap fix)
        const serverHist = await loadExecutionsFromApi();
        if (serverHist.length) {
          setExecutions((prev) => {
            const ids = new Set(prev.map((p: any) => p.id));
            const merged = [...serverHist.filter((s: any) => !ids.has(s.id)), ...prev];
            return merged.slice(0, 50);
          });
        }
      } else {
        // original local load - per-user key for isolation
        const key = currentUser ? `n8nlike-workflow-${currentUser.id}` : "n8nlike-workflow";
        const saved = localStorage.getItem(key);
        if (saved) {
          try {
            const parsed: Workflow = normalizeWorkflow(JSON.parse(saved));
            setWorkflow(parsed);
            setNodes(parsed.nodes || []);
            setEdges(parsed.edges || []);
            toast.success("Loaded saved workflow (local)");
          } catch {}
        } else {
          // Seed a starter workflow
          const starterNodes: WorkflowNode[] = [
            {
              id: "start-1",
              type: "manualTrigger",
              position: { x: 80, y: 180 },
              data: { label: "Start", parameters: { seedData: { userId: 123, action: "signup", now: new Date().toISOString() } } },
            },
            {
              id: "set-1",
              type: "set",
              position: { x: 340, y: 180 },
              data: {
                label: "Enrich Data",
                parameters: {
                  assignments: [
                    { key: "status", value: "active" },
                    { key: "timestamp", value: "{{ $json.now }}" },
                  ],
                },
              },
            },
          ];
          const starterEdges: WorkflowEdge[] = [
            { id: "e1", source: "start-1", target: "set-1", sourceHandle: "main", targetHandle: "in" },
          ];
          setNodes(starterNodes);
          setEdges(starterEdges);
          setWorkflow((w) => ({ ...w, nodes: starterNodes, edges: starterEdges }));
        }
      }
    };
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setNodes, setEdges, currentUser]);

  // When useApi toggled (after mount), sync list or local
  useEffect(() => {
    // Persist preference
    localStorage.setItem("n8nlike-use-api", String(useApi));

    const syncMode = async () => {
      if (useApi) {
        const list = await loadWorkflowsFromApi();
        const currentInList = list.some((w) => w.id === workflow.id);
        if (list.length > 0 && !currentInList) {
          await loadWorkflowByIdFromApi(list[0].id);
        } else if (list.length === 0) {
          await createNewWorkflowViaApi();
        }
      } else {
        // switched to local: ensure we have a local copy
        if (workflow.nodes.length === 0 && workflow.edges.length === 0) {
          const saved = localStorage.getItem(currentUser ? `n8nlike-workflow-${currentUser.id}` : "n8nlike-workflow");
          if (saved) {
            try {
              const p = normalizeWorkflow(JSON.parse(saved));
              setWorkflow(p);
              setNodes(p.nodes || []);
              setEdges(p.edges || []);
            } catch {}
          }
        }
      }
    };
    // Call sync on toggle (after initial render); the mount effect handled first
    // Use a micro-delay to allow state settle
    const t = setTimeout(() => { syncMode(); }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useApi]);

  // Persist to localStorage ONLY when in local mode (per-user key for isolation)
  useEffect(() => {
    if (!useApi && (workflow.nodes.length > 0 || workflow.edges.length > 0) && currentUser) {
      const key = `n8nlike-workflow-${currentUser.id}`;
      localStorage.setItem(key, JSON.stringify(workflow));
    }
  }, [workflow, useApi, currentUser]);

  // Keep ReactFlow in sync when workflow changes externally
  useEffect(() => {
    setNodes(workflow.nodes);
    setEdges(workflow.edges);
  }, [workflow.id]); // only on id switch

  // Simple history for undo (basic stack, push before mutations)
  // DEFINED EARLY to avoid TDZ/ReferenceError in callbacks declared before it in source (e.g. onConnect)
  const pushToHistory = useCallback((nds?: WorkflowNode[], eds?: WorkflowEdge[]) => {
    const currNodes = (nds || nodes) as WorkflowNode[];
    const currEdges = (eds || edges) as WorkflowEdge[];
    const snapshot = {
      nodes: JSON.parse(JSON.stringify(currNodes)),
      edges: JSON.parse(JSON.stringify(currEdges)),
    };
    setHistoryStack((prev) => {
      const trimmed = prev.slice(0, historyIndex + 1);
      const next = [...trimmed, snapshot].slice(-20);
      return next;
    });
    setHistoryIndex((prevIdx) => {
      const nextLen = Math.min((prevIdx + 1) + 1, 20);
      return nextLen - 1;
    });
  }, [nodes, edges, historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const prev = historyStack[historyIndex - 1];
    if (!prev) return;
    setNodes(prev.nodes);
    setEdges(prev.edges);
    setHistoryIndex((i) => i - 1);
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    toast.info("Undo");
  }, [historyIndex, historyStack, setNodes, setEdges]);

  const redo = useCallback(() => {
    if (historyIndex >= historyStack.length - 1) return;
    const nextSnap = historyStack[historyIndex + 1];
    if (!nextSnap) return;
    setNodes(nextSnap.nodes);
    setEdges(nextSnap.edges);
    setHistoryIndex((i) => i + 1);
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    toast.info("Redo");
  }, [historyIndex, historyStack, setNodes, setEdges]);

  const onConnect = useCallback(
    (connection: Connection) => {
      pushToHistory(nodes, edges);
      const edge = {
        ...connection,
        id: `e-${uuidv4().slice(0, 8)}`,
      } as WorkflowEdge;
      setEdges((eds) => addEdge(edge, eds));
    },
    [setEdges, pushToHistory, nodes, edges]
  );

  // Extracted insert logic for edge + buttons and click (#7)
  // function decl (hoisted) so CustomEdge/onEdgeClick can close over it without TDZ regardless of source order
  function insertNodeOnEdge(edge: any) {
    const srcNode = (nodes as any[]).find((n: any) => n.id === edge.source);
    const tgtNode = (nodes as any[]).find((n: any) => n.id === edge.target);
    if (!srcNode || !tgtNode) return;
    pushToHistory(nodes, edges);
    const midX = (srcNode.position.x + tgtNode.position.x) / 2 + (Math.random() - 0.5) * 20;
    const midY = (srcNode.position.y + tgtNode.position.y) / 2 + 30;
    const newId = `ins-${uuidv4().slice(0, 8)}`;
    const newNode: any = {
      id: newId,
      type: "set",
      position: { x: midX, y: midY },
      data: { label: "Inserted", parameters: { assignments: [] } },
    };
    setNodes((nds: any[]) => [...nds, newNode]);
    setEdges((eds: any[]) => {
      const filtered = eds.filter((e: any) => e.id !== edge.id);
      return [
        ...filtered,
        { id: `e-${edge.source}-${newId}`, source: edge.source, target: newId, sourceHandle: edge.sourceHandle || "main", targetHandle: "in" },
        { id: `e-${newId}-${edge.target}`, source: newId, target: edge.target, sourceHandle: "main", targetHandle: edge.targetHandle || "in" },
      ];
    });
    setSelectedNodeId(newId);
    toast.success("Node inserted on edge (Set). Use + buttons or click edges.");
  }

  // Custom edge with + insert button for #7 polish (visible on every connection)
  const CustomEdge = useCallback((props: EdgeProps) => {
    const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style = {}, markerEnd } = props;
    const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
    const onPlus = (e: React.MouseEvent) => {
      e.stopPropagation();
      const edge = (edges as any[]).find((e: any) => e.id === id);
      if (edge) insertNodeOnEdge(edge);
    };
    return (
      <>
        <BaseEdge path={edgePath} markerEnd={markerEnd} style={{ ...style, stroke: "#5c8df6", strokeWidth: 2 }} />
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              zIndex: 10,
              pointerEvents: "all",
            }}
            className="nodrag nopan"
          >
            <button
              onClick={onPlus}
              title="Insert node on this edge"
              className="w-[15px] h-[15px] rounded-full bg-[#5c8df6] hover:bg-white text-black text-[11px] font-bold leading-[13px] flex items-center justify-center border border-[#0f1115] shadow-sm active:scale-90 transition"
            >
              +
            </button>
          </div>
        </EdgeLabelRenderer>
      </>
    );
  }, [edges, insertNodeOnEdge]);

  const edgeTypes: EdgeTypes = useMemo(() => ({ default: CustomEdge }), [CustomEdge]);

  // Edge insert button (Future #7): click any edge OR use + button on custom edge
  const onEdgeClick = useCallback((event: any, edge: any) => {
    insertNodeOnEdge(edge);
  }, [insertNodeOnEdge]);

  // Context menu stub handlers (typed to match React Flow expectations)
  const closeContext = () => setContextMenu(null);
  const onPaneContextMenu = (e: MouseEvent | React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: (e as any).clientX, y: (e as any).clientY });
  };
  const onNodeContextMenu = (e: MouseEvent | React.MouseEvent, node: any) => {
    e.preventDefault();
    setContextMenu({ x: (e as any).clientX, y: (e as any).clientY, nodeId: node.id });
  };
  const onEdgeContextMenu = (e: MouseEvent | React.MouseEvent, edge: any) => {
    e.preventDefault();
    setContextMenu({ x: (e as any).clientX, y: (e as any).clientY, edgeId: edge.id });
  };

  const handleContextAction = (action: string) => {
    const cm = contextMenu;
    closeContext();
    if (!cm) return;
    pushToHistory(nodes, edges);
    if (action === "add-set") {
      const pos = { x: (cm.x - 200) / 1.2 || 180 + Math.random() * 120, y: (cm.y - 120) / 1.2 || 140 + Math.random() * 80 };
      addNode("set", pos);
    } else if (action === "add-if") {
      const pos = { x: (cm.x - 200) / 1.2 || 220 + Math.random() * 100, y: (cm.y - 120) / 1.2 || 160 };
      addNode("if", pos);
    } else if (action === "add-http") {
      const pos = { x: (cm.x - 220) / 1.2 || 260, y: (cm.y - 100) / 1.2 || 180 };
      addNode("httpRequest", pos);
    } else if (action === "add-code") {
      const pos = { x: (cm.x - 200) / 1.2 || 300, y: (cm.y - 140) / 1.2 || 200 };
      addNode("code", pos);
    } else if (action === "group") {
      // group using multi-select state (context may target 1, fall back to selected)
      closeContext();
      groupSelectedNodes();
      return;
    } else if (action === "ungroup" && cm.nodeId) {
      // basic ungroup: move children out by clearing parent/extent and offsetting
      const groupN = (nodes as any[]).find((n: any) => n.id === cm.nodeId);
      const children = (nodes as any[]).filter((n: any) => n.parentNode === cm.nodeId);
      if (children.length) {
        const offsetX = (groupN?.position?.x || 0) + 20;
        const offsetY = (groupN?.position?.y || 0) + 60;
        setNodes((nds: any[]) => nds.map(n => n.parentNode === cm.nodeId ? { ...n, parentNode: undefined, extent: undefined, position: { x: n.position.x + offsetX, y: n.position.y + offsetY } } : n ).filter(n => n.id !== cm.nodeId));
      } else {
        setNodes(nds => (nds as any[]).filter(n=>n.id!==cm.nodeId));
      }
    } else if (action === "layout") {
      // trigger layout (re-uses button logic inline) - improved spacing
      const nodeList = nodes as any[];
      const edgeList = edges as any[];
      const adj = new Map<string, string[]>(); const indeg = new Map<string, number>();
      nodeList.forEach(n => { adj.set(n.id, []); indeg.set(n.id, 0); });
      edgeList.forEach((e: any) => { adj.get(e.source)?.push(e.target); indeg.set(e.target, (indeg.get(e.target)||0)+1); });
      let q: string[] = nodeList.filter(n => (indeg.get(n.id)||0)===0).map(n=>n.id);
      const levs: string[][] = []; let l=0;
      const vis = new Set<string>();
      while(q.length){ levs[l]=[...q]; const nq:string[]=[]; q.forEach(id=>{ vis.add(id); (adj.get(id)||[]).forEach(t=>{ indeg.set(t,(indeg.get(t)||0)-1); if((indeg.get(t)||0)===0) nq.push(t);}); }); q=nq; l++; }
      const rem = nodeList.filter(n=>!vis.has(n.id)).map(n=>n.id); if(rem.length) levs.push(rem);
      const pmap: any = {}; levs.forEach((lv,li)=> lv.forEach((id,ii)=> pmap[id]={x:80 + li*260, y:80 + ii*110 }));
      setNodes(nds => (nds as any[]).map(n=>({...n, position: pmap[n.id]||n.position, parentNode: undefined, extent: undefined }))); // ungroup on full relayout
    } else if (action === "delete" && (cm.nodeId || cm.edgeId)) {
      if (cm.nodeId) setNodes(nds => (nds as any[]).filter(n=>n.id!==cm.nodeId));
      if (cm.edgeId) setEdges(eds => (eds as any[]).filter(e=>e.id!==cm.edgeId));
    }
    toast.info(`Context: ${action}`);
  };

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) as WorkflowNode | undefined,
    [nodes, selectedNodeId]
  );

  const selectedHistory = useMemo(
    () => (selectedHistoryId ? executions.find((e) => e.id === selectedHistoryId) || null : null),
    [selectedHistoryId, executions]
  );

  const lastExecution = executions[0] || null;

  // Multi-select handling for polish - now safe because whole N8nlike is under ReactFlowProvider (see dynamic wrapper)
  useOnSelectionChange({
    onChange: useCallback(({ nodes: selNodes, edges: selEdges }) => {
      const nIds = selNodes.map((n: any) => n.id);
      const eIds = selEdges.map((e: any) => e.id);
      setSelectedNodeIds(nIds);
      setSelectedEdgeIds(eIds);
      if (nIds.length === 1) {
        setSelectedNodeId(nIds[0]);
      } else if (nIds.length === 0) {
        // keep last single if no node but edge? or clear
      } else {
        setSelectedNodeId(null);
      }
    }, []),
  });

  const addNode = useCallback((type: NodeType, position?: { x: number; y: number }, parentId?: string) => {
    const def = getNodeDefinition(type);
    const newNode: WorkflowNode = {
      id: `${type}-${uuidv4().slice(0, 8)}`,
      type,
      position: position || { x: 200 + Math.random() * 200, y: 120 + Math.random() * 200 },
      data: {
        label: def.label,
        parameters: JSON.parse(JSON.stringify(def.defaultParameters)),
      },
      ...(parentId ? { parentNode: parentId, extent: "parent" as const } : {}),
    };

    pushToHistory(nodes, edges);
    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newNode.id);
    toast.success(`Added ${def.label}${parentId ? " (grouped)" : ""}`);
  }, [nodes, edges, pushToHistory, setNodes]);

  // Drag from palette
  const onDragStart = (event: React.DragEvent, nodeType: NodeType) => {
    event.dataTransfer.setData("application/reactflow", nodeType);
    event.dataTransfer.effectAllowed = "move";
  };

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData("application/reactflow") as NodeType;
      if (!type) return;

      const reactFlowBounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
      // Rough position (good enough for MVP; better with screenToFlowPosition in prod)
      const position = {
        x: event.clientX - reactFlowBounds.left - 100,
        y: event.clientY - reactFlowBounds.top - 40,
      };

      addNode(type, position);
    },
    [addNode]
  );

  const onNodeClick = useCallback((_e: any, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const updateSelectedNodeParams = (newParams: Record<string, any>) => {
    if (!selectedNodeId) return;

    // NOTE: pushToHistory removed here to prevent undo-stack flooding on every keystroke in live param editors.
    // Structural changes (add/delete/connect) + explicit actions still push.
    setNodes((nds) =>
      nds.map((node) =>
        node.id === selectedNodeId
          ? {
              ...node,
              data: {
                ...node.data,
                parameters: { ...node.data.parameters, ...newParams },
              },
            }
          : node
      )
    );

    // sync

  };

  // Run the workflow
  const runWorkflow = useCallback(async (workflowOverride?: Partial<Workflow>) => {
    const baseWorkflow: Workflow = {
      ...workflow,
      nodes: nodes as WorkflowNode[],
      edges: edges as WorkflowEdge[],
    };
    const currentWorkflow: Workflow = {
      ...baseWorkflow,
      ...(workflowOverride || {}),
      nodes: (workflowOverride?.nodes as WorkflowNode[]) || baseWorkflow.nodes,
      edges: (workflowOverride?.edges as WorkflowEdge[]) || baseWorkflow.edges,
    };

    if (currentWorkflow.nodes.length === 0) {
      toast.error("Add at least one node first");
      return;
    }

    setIsRunning(true);
    setExecution(null);
    setExpandedLiveSteps(new Set());
    setOutputPreviews({});

    // Mark all nodes as running for live status during execution (until result arrives)
    const initialRunning: Record<string, 'running' | 'success' | 'error'> = {};
    currentWorkflow.nodes.forEach((n) => { initialRunning[n.id] = 'running'; });
    setNodeStatuses(initialRunning);

    try {
      let result: ExecutionResult;
      if (useApi) {
        // Prefer server execution in API mode for secure real integrations (env keys + server creds)
        try {
          await saveWorkflowToApi();
          const execData = await apiFetch(`/api/webhooks/${encodeURIComponent(currentWorkflow.id)}`, {
            method: "POST",
            body: JSON.stringify({}),
          });
          result = execData?.execution || execData;
        } catch (apiErr: any) {
          // fallback to local client with resolved creds
          toast.info("Server exec failed, using local: " + (apiErr?.message || ""));
          const resolvedNodesForRun = (currentWorkflow.nodes as WorkflowNode[]).map((n) => {
            const p = { ...(n.data.parameters || {}) };
            const cid = p.credentialId;
            if (cid) {
              const c = credentials.find((cc: any) => cc.id === cid) || listClientCredentials(currentUser?.id).find((cc) => cc.id === cid);
              if (c) {
                try {
                  const d = getDecryptedData(c as any, currentUser?.id);
                  if (d.apiKey) p.apiKey = d.apiKey;
                  if (d.accessToken) p.apiKey = d.accessToken;
                  if (d.resendApiKey) p.resendApiKey = d.resendApiKey;
                  if (d.botToken) p.botToken = d.botToken;
                  if (d.username) p.username = d.username;
                  if (d.password) p.password = d.password;
                  if (d.smtpHost) p.smtpHost = d.smtpHost;
                  if (d.smtpPort) p.smtpPort = d.smtpPort;
                  if (d.smtpUser) p.smtpUser = d.smtpUser;
                  if (d.smtpPass) p.smtpPass = d.smtpPass;
                  if (d.values) {
                    const vv = typeof d.values === "string" ? (() => { try { return JSON.parse(d.values); } catch { return {}; } })() : d.values;
                    Object.assign(p, vv);
                  }
                } catch {}
              }
            }
            return { ...n, data: { ...n.data, parameters: p } };
          });
          const wfForExec = { ...currentWorkflow, nodes: resolvedNodesForRun };
          result = await executeWorkflow(wfForExec, credentials, currentUser?.id);
        }
      } else {
        // Client-side: resolve credentialId -> inject apiKey etc into params for real nodes (secure local only)
        const resolvedNodesForRun = (currentWorkflow.nodes as WorkflowNode[]).map((n) => {
          const p = { ...(n.data.parameters || {}) };
          const cid = p.credentialId;
          if (cid) {
            const c = credentials.find((cc: any) => cc.id === cid) || listClientCredentials(currentUser?.id).find((cc) => cc.id === cid);
            if (c) {
              try {
                const d = getDecryptedData(c as any, currentUser?.id);
                if (d.apiKey) p.apiKey = d.apiKey;
                if (d.accessToken) p.apiKey = d.accessToken;
                if (d.resendApiKey) p.resendApiKey = d.resendApiKey;
                if (d.botToken) p.botToken = d.botToken;
                if (d.username) p.username = d.username;
                if (d.password) p.password = d.password;
                if (d.smtpHost) p.smtpHost = d.smtpHost;
                if (d.smtpPort) p.smtpPort = d.smtpPort;
                if (d.smtpUser) p.smtpUser = d.smtpUser;
                if (d.smtpPass) p.smtpPass = d.smtpPass;
                if (d.values) {
                  const vv = typeof d.values === "string" ? (() => { try { return JSON.parse(d.values); } catch { return {}; } })() : d.values;
                  Object.assign(p, vv);
                }
              } catch {}
            }
          }
          return { ...n, data: { ...n.data, parameters: p } };
        });
        const wfForExec = { ...currentWorkflow, nodes: resolvedNodesForRun };
        result = await executeWorkflow(wfForExec, credentials, currentUser?.id);
      }
      setExecution(result);

      // Set execution viz on nodes + previews (for canvas badges) -- overrides running
      const statuses: Record<string, 'success' | 'error'> = {};
      const previews: Record<string, string> = {};
      result.results.forEach((r) => {
        statuses[r.nodeId] = r.error ? "error" : "success";
        try {
          // Minor adaptation: for richer ExecutionItem[] results, preview the first item's json
          const firstJson = Array.isArray(r.output) && r.output[0] && (r.output[0] as ExecutionItem).json
            ? (r.output[0] as ExecutionItem).json
            : r.output;
          const short = JSON.stringify(firstJson ?? {}).slice(0, 42);
          previews[r.nodeId] = short + (JSON.stringify(firstJson ?? {}).length > 42 ? "…" : "");
        } catch {
          previews[r.nodeId] = String((r.output as any) ?? "").slice(0, 42);
        }
      });
      setNodeStatuses(statuses as any);
      setOutputPreviews(previews);

      // Persist to history (user scoped)
      try {
        const savedRecord = saveExecution({ ...result, userId: currentUser?.id } as any, currentWorkflow, currentUser?.id);
        setExecutions((prev) => [savedRecord, ...prev].slice(0, 50));
      } catch {}
      // Also mirror to server when API mode (makes server execs + webhook runs visible in History)
      saveExecutionToApi(result, currentWorkflow);

      if (result.success) {
        toast.success(`Workflow finished in ${result.results.length} step(s)`);
      } else {
        toast.error(result.error || "Execution failed");
      }
    } catch (err: any) {
      const failResult: ExecutionResult = {
        success: false,
        results: [],
        error: err.message,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      };
      setExecution(failResult);
      // partial viz if any (clear lingering 'running' too)
      const statusesFail: Record<string, 'success' | 'error'> = {};
      const previewsFail: Record<string, string> = {};
      (failResult.results || []).forEach((r) => {
        statusesFail[r.nodeId] = r.error ? "error" : "success";
        const firstJson = Array.isArray(r.output) && r.output[0] && (r.output[0] as any)?.json ? (r.output[0] as any).json : r.output;
        previewsFail[r.nodeId] = String(firstJson ?? "").slice(0, 42);
      });
      setNodeStatuses(statusesFail as any);
      setOutputPreviews(previewsFail);
      try {
        const savedRecord = saveExecution(failResult, currentWorkflow, currentUser?.id);
        setExecutions((prev) => [savedRecord, ...prev].slice(0, 50));
      } catch {}
      saveExecutionToApi(failResult, currentWorkflow);
      toast.error("Unexpected error: " + err.message);
    } finally {
      setIsRunning(false);
    }
  }, [workflow, nodes, edges, rightTab, useApi, credentials]);

  // Fire triggers via REAL server execution (webhook endpoint for schedule/webhook/form/manual).
  // Ensures reliable server-side path + rich data. Active required. For demo + prod.
  const fireTriggerViaServer = useCallback(async (triggerType?: string) => {
    if (!useApi) {
      toast.info("Switch to API mode to fire real triggers");
      return;
    }
    if (!workflow.id) {
      toast.error("Save to API first to enable server triggers");
      return;
    }
    setIsRunning(true);
    setExecution(null);
    setExpandedLiveSteps(new Set());

    try {
      const res = await fetch(`/api/webhooks/${encodeURIComponent(workflow.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { manualFire: true, firedBy: "ui", triggerType: triggerType || "ui", ts: new Date().toISOString() } }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.success === false) {
        throw new Error(json.error || `Trigger API error ${res.status}`);
      }
      const result = json.data?.execution || json;
      setExecution(result);

      const statuses: Record<string, 'success' | 'error'> = {};
      const previews: Record<string, string> = {};
      (result.results || []).forEach((r: any) => {
        statuses[r.nodeId] = r.error ? "error" : "success";
        const first = Array.isArray(r.output) && r.output[0] && (r.output[0] as any)?.json ? (r.output[0] as any).json : r.output;
        previews[r.nodeId] = JSON.stringify(first ?? {}).slice(0, 42);
      });
      setNodeStatuses(statuses as any);
      setOutputPreviews(previews);

      try {
        const savedRecord = saveExecution(result, { ...workflow, nodes: nodes as any, edges: edges as any } as any, currentUser?.id);
        setExecutions((prev) => [savedRecord, ...prev].slice(0, 50));
      } catch {}
      saveExecutionToApi(result, { ...workflow, nodes: nodes as any, edges: edges as any } as any);

      toast.success(`Real server trigger fired • ${result.success ? "OK" : "FAIL"}`);
    } catch (e: any) {
      toast.error("Real fire failed: " + (e.message || e));
    } finally {
      setIsRunning(false);
    }
  }, [useApi, workflow, nodes, edges, credentials]);

  // History actions
  const reRunExecution = (record: ExecutionRecord) => {
    if (!record.workflowSnapshot || !Array.isArray(record.workflowSnapshot.nodes) || record.workflowSnapshot.nodes.length === 0) {
      toast.error("No workflow snapshot (server/webhook run) - cannot restore/re-run from here");
      return;
    }
    // Load snapshot into canvas, then run
    const snap = record.workflowSnapshot;
    const restoredWorkflow: Workflow = {
      id: `wf-${Date.now()}`,
      name: `${snap.name} (from history)`,
      nodes: JSON.parse(JSON.stringify(snap.nodes)),
      edges: JSON.parse(JSON.stringify(snap.edges)),
      isPublished: false,
      versions: [],
    };
    setWorkflow(restoredWorkflow);
    setNodes(restoredWorkflow.nodes);
    setEdges(restoredWorkflow.edges);
    setSelectedNodeId(null);
    setExecution(null);
    setSelectedHistoryId(null);
    // Run the restored workflow
    setTimeout(() => {
      runWorkflow(restoredWorkflow);
    }, 50);
    toast.success("Re-running execution from snapshot");
  };

  const loadWorkflowFromExecution = (record: ExecutionRecord) => {
    if (!record.workflowSnapshot || !Array.isArray(record.workflowSnapshot.nodes) || record.workflowSnapshot.nodes.length === 0) {
      toast.error("No workflow snapshot available for this execution");
      return;
    }
    const snap = record.workflowSnapshot;
    const restored: Workflow = {
      id: `wf-${Date.now()}`,
      name: snap.name,
      nodes: JSON.parse(JSON.stringify(snap.nodes)),
      edges: JSON.parse(JSON.stringify(snap.edges)),
      isPublished: false,
      versions: [],
    };
    setWorkflow(restored);
    setNodes(restored.nodes);
    setEdges(restored.edges);
    setSelectedNodeId(null);
    setExecution(null);
    setSelectedHistoryId(null);
    setRightTab("inspector");
    toast.success(`Loaded workflow snapshot: ${snap.name}`);
  };

  const clearAllHistory = () => {
    clearExecutions(currentUser?.id);
    setExecutions([]);
    setSelectedHistoryId(null);
    toast.info("Execution history cleared");
  };

  const removeHistoryRecord = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    deleteExecution(id, currentUser?.id);
    setExecutions((prev) => prev.filter((r) => r.id !== id));
    if (selectedHistoryId === id) setSelectedHistoryId(null);
    toast.info("Execution removed from history");
  };

  const selectHistoryRecord = (id: string) => {
    setSelectedHistoryId(id);
  };

  // --- Credentials Manager logic (create/edit/delete + test) ---
  const openNewCredential = (defaultType: CredentialType = "apiKey") => {
    setEditingCredId(null);
    const def = getCredentialTypeDef(defaultType)!;
    const emptyData: Record<string, any> = {};
    def.fields.forEach((f) => { emptyData[f.key] = ""; });
    setCredForm({ name: `${def.label} Credential`, type: defaultType, data: emptyData });
    setCredTestResult(null);
    setShowCredManager(true);
  };

  const openEditCredential = (cred: Credential) => {
    setEditingCredId(cred.id);
    const plain = getDecryptedData(cred, currentUser?.id);
    setCredForm({ name: cred.name, type: cred.type, data: plain });
    setCredTestResult(null);
    setShowCredManager(true);
  };

  const closeCredManager = () => {
    setShowCredManager(false);
    setEditingCredId(null);
    setCredTestResult(null);
  };

  const updateCredFormField = (key: string, value: any) => {
    setCredForm((prev) => ({
      ...prev,
      data: { ...prev.data, [key]: value },
    }));
  };

  const saveCurrentCredential = async () => {
    if (!credForm.name.trim()) {
      toast.error("Credential name required");
      return;
    }
    try {
      await saveCredentialToStore(credForm.data, {
        id: editingCredId || undefined,
        name: credForm.name.trim(),
        type: credForm.type,
      });
      toast.success(editingCredId ? "Credential updated" : "Credential created");
      closeCredManager();
    } catch (e: any) {
      toast.error("Save failed: " + (e?.message || e));
    }
  };

  const deleteCurrentEditingCred = async () => {
    if (!editingCredId) return;
    if (!confirm("Delete this credential? Nodes using it will lose reference.")) return;
    await deleteCredentialFromStore(editingCredId);
    closeCredManager();
  };

  // Simple Test Connection (MVP): uses browser fetch with built auth header where sensible
  const testCurrentCredential = async () => {
    setCredTestResult("Testing...");
    const { type, data } = credForm;
    let resultMsg = "";
    try {
      if (type === "apiKey" || type === "oauth2" || type === "basicAuth") {
        // Build headers from form (same logic as execution)
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (data.apiKey) {
          const h = data.headerName || "X-API-Key";
          const pfx = data.prefix ? data.prefix + " " : "";
          headers[h] = pfx + data.apiKey;
        } else if (data.accessToken) {
          const tt = data.tokenType || "Bearer";
          headers.Authorization = `${tt} ${data.accessToken}`;
        } else if (data.username && data.password) {
          const b64 = btoa(`${data.username}:${data.password}`);
          headers.Authorization = `Basic ${b64}`;
        }
        // Use a safe echo endpoint for demo
        const testUrl = "https://httpbin.org/headers";
        const res = await fetch(testUrl, { method: "GET", headers });
        const json = await res.json().catch(() => ({}));
        resultMsg = res.ok
          ? `SUCCESS (HTTP ${res.status}) — headers echoed. ${Object.keys(headers).filter((k) => k.toLowerCase().includes("auth") || k.toLowerCase().includes("key")).length ? "Auth header sent." : ""}`
          : `HTTP ${res.status}`;
      } else if (type === "generic") {
        resultMsg = "Generic credential: no automated test (validates format OK). Values: " + JSON.stringify(data).slice(0, 80);
      } else {
        resultMsg = "Test not implemented for this type in MVP (valid).";
      }
    } catch (err: any) {
      resultMsg = "Test error: " + (err.message || "network or CORS (httpbin may be blocked)");
    }
    setCredTestResult(resultMsg);
  };

  // Live log collapsible helpers
  const toggleLiveStep = (idx: number) => {
    setExpandedLiveSteps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // Bulk delete for multi-select and keyboard
  const deleteSelected = useCallback(() => {
    const nodesToDelete = selectedNodeIds.length > 0 ? selectedNodeIds : (selectedNodeId ? [selectedNodeId] : []);
    const edgesToDelete = selectedEdgeIds;
    if (nodesToDelete.length === 0 && edgesToDelete.length === 0) return;

    pushToHistory(nodes, edges);
    setNodes((nds) => nds.filter((n) => !nodesToDelete.includes(n.id)));
    setEdges((eds) =>
      eds.filter(
        (e) =>
          !nodesToDelete.includes(e.source) &&
          !nodesToDelete.includes(e.target) &&
          !edgesToDelete.includes(e.id)
      )
    );
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    toast.info(`Deleted ${nodesToDelete.length} node(s) / ${edgesToDelete.length} edge(s)`);
  }, [selectedNodeIds, selectedNodeId, selectedEdgeIds, pushToHistory, setNodes, setEdges, nodes, edges]);

  const clearWorkflow = useCallback(() => {
    const empty: Workflow = {
      id: `wf-${Date.now()}`,
      name: "New Workflow",
      nodes: [],
      edges: [],
      isPublished: false,
      versions: [],
    };
    setWorkflow(empty);
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    setExecution(null);
    setSelectedHistoryId(null);
    setNodeStatuses({});
    setOutputPreviews({});
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setHistoryStack([]);
    setHistoryIndex(-1);
    if (!useApi) {
      const key = currentUser ? `n8nlike-workflow-${currentUser.id}` : "n8nlike-workflow";
      localStorage.removeItem(key);
    }
    toast.info("Workflow cleared");
  }, [useApi, currentUser, setNodes, setEdges]);

  const fireSelectedTrigger = () => {
    const selType = selectedNodeId ? nodes.find((n: any) => n.id === selectedNodeId)?.type : undefined;
    fireTriggerViaServer(selType);
  };

  const saveWorkflow = useCallback(() => {
    // Versioning integration: record snapshot before persist
    const now = new Date().toISOString();
    const currV = Array.isArray(workflow.versions) ? workflow.versions : [];
    const nextVerNum = (currV.length > 0 ? Math.max(0, ...currV.map((v: any) => v.version || 0)) : 0) + 1;
    const snap: WorkflowVersion = {
      version: nextVerNum,
      name: workflow.name,
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
      savedAt: now,
    };
    let versions = [...currV];
    const last = versions[versions.length - 1];
    if (!last || JSON.stringify(last.nodes) !== JSON.stringify(snap.nodes) || JSON.stringify(last.edges) !== JSON.stringify(snap.edges)) {
      versions.push(snap);
    }
    if (versions.length > 10) versions = versions.slice(-10);
    const wf = { ...workflow, nodes, edges, updatedAt: now, versions, isPublished: workflow.isPublished ?? false };
    if (useApi) {
      saveWorkflowToApi();
    } else {
      localStorage.setItem(currentUser ? `n8nlike-workflow-${currentUser.id}` : "n8nlike-workflow", JSON.stringify(wf));
      setWorkflow(wf);
      toast.success("Workflow saved locally");
    }
  }, [workflow, nodes, edges, useApi]);

  const exportWorkflow = () => {
    const wf = { ...workflow, nodes, edges };
    const blob = new Blob([JSON.stringify(wf, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${wf.name.replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported workflow JSON");
  };

  const importWorkflow = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const imported: Workflow = JSON.parse(ev.target?.result as string);
          imported.id = `wf-${Date.now()}`;
          const importedNorm = normalizeWorkflow(imported);
          setWorkflow(importedNorm);
          setNodes(importedNorm.nodes || []);
          setEdges(importedNorm.edges || []);
          setSelectedNodeId(null);
          setExecution(null);
          setSelectedHistoryId(null);
          setNodeStatuses({});
          setOutputPreviews({});
          setHistoryStack([]);
          setHistoryIndex(-1);
          toast.success("Workflow imported");
        } catch {
          toast.error("Invalid workflow file");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // --- Versioning + Templates helpers (High Priority #6) ---
  // (normalizeWorkflow hoisted earlier for load fns)
  const TEMPLATES: Array<{ name: string; description: string; data: Partial<Workflow> }> = [
    {
      name: "HTTP Poller + Set",
      description: "Manual start → HTTP GET → enrich with Set",
      data: {
        name: "HTTP Poller + Set",
        nodes: [
          { id: "t1", type: "manualTrigger", position: { x: 80, y: 120 }, data: { label: "Start", parameters: { seedData: { run: true } } } },
          { id: "t2", type: "httpRequest", position: { x: 320, y: 120 }, data: { label: "Fetch Data", parameters: { method: "GET", url: "https://jsonplaceholder.typicode.com/posts/1" } } },
          { id: "t3", type: "set", position: { x: 580, y: 120 }, data: { label: "Enrich", parameters: { assignments: [{ key: "fetchedAt", value: "{{ $now }}" }] } } },
        ],
        edges: [
          { id: "te1", source: "t1", target: "t2", sourceHandle: "main", targetHandle: "in" },
          { id: "te2", source: "t2", target: "t3", sourceHandle: "main", targetHandle: "in" },
        ],
      },
    },
    {
      name: "Webhook → IF → Email",
      description: "Webhook trigger with conditional email branch",
      data: {
        name: "Webhook → IF → Email",
        nodes: [
          { id: "w1", type: "webhookTrigger", position: { x: 60, y: 140 }, data: { label: "Incoming Webhook", parameters: { testPayload: { order: { total: 99, status: "paid" } } } } },
          { id: "w2", type: "if", position: { x: 300, y: 140 }, data: { label: "Paid?", parameters: { left: "order.status", operator: "equals", right: "paid" } } },
          { id: "w3", type: "email", position: { x: 560, y: 80 }, data: { label: "Notify Success", parameters: { to: "sales@example.com", subject: "Paid order", body: "Total: {{ $json.order.total }}" } } },
        ],
        edges: [
          { id: "we1", source: "w1", target: "w2", sourceHandle: "main", targetHandle: "in" },
          { id: "we2", source: "w2", target: "w3", sourceHandle: "true", targetHandle: "in" },
        ],
      },
    },
    {
      name: "AI Summary Loop",
      description: "Schedule + AI + Loop (curated import)",
      data: {
        name: "AI Summary Loop",
        nodes: [
          { id: "a1", type: "scheduleTrigger", position: { x: 40, y: 100 }, data: { label: "Daily", parameters: { schedule: "0 8 * * *" } } },
          { id: "a2", type: "aiLlm", position: { x: 260, y: 100 }, data: { label: "Summarize", parameters: { prompt: "Summarize input data briefly." } } },
          { id: "a3", type: "loop", position: { x: 480, y: 100 }, data: { label: "x3", parameters: { iterations: 3 } } },
        ],
        edges: [
          { id: "ae1", source: "a1", target: "a2", sourceHandle: "main", targetHandle: "in" },
          { id: "ae2", source: "a2", target: "a3", sourceHandle: "main", targetHandle: "in" },
        ],
      },
    },
    {
      name: "Webhook + Subflow Demo",
      description: "Webhook to sub-workflow ref (uses subWorkflow node)",
      data: {
        name: "Webhook + Subflow Demo",
        nodes: [
          { id: "w1", type: "webhookTrigger", position: { x: 60, y: 140 }, data: { label: "Hook", parameters: { testPayload: { msg: "hi" } } } },
          { id: "s1", type: "subWorkflow", position: { x: 320, y: 140 }, data: { label: "Call Sub", parameters: { workflowId: "(pick in inspector)" } } },
        ],
        edges: [
          { id: "we1", source: "w1", target: "s1", sourceHandle: "main", targetHandle: "in" },
        ],
      },
    },
  ];

  const loadTemplate = (tpl: { name: string; data: Partial<Workflow> }) => {
    pushToHistory(nodes, edges);
    const newId = `wf-tpl-${Date.now()}`;
    const loaded: Workflow = {
      id: newId,
      name: tpl.name,
      nodes: JSON.parse(JSON.stringify(tpl.data.nodes || [])),
      edges: JSON.parse(JSON.stringify(tpl.data.edges || [])),
      isPublished: false,
      versions: [],
    };
    setWorkflow(loaded);
    setNodes(loaded.nodes);
    setEdges(loaded.edges);
    setSelectedNodeId(null);
    setExecution(null);
    setSelectedHistoryId(null);
    setNodeStatuses({});
    setOutputPreviews({});
    setHistoryStack([]);
    setHistoryIndex(-1);
    setRightTab("inspector");
    toast.success(`Loaded template: ${tpl.name}`);
  };

  // (normalizeWorkflow is defined earlier to be available to api/load fns)

  // Versioning: append current state as new version (client side, mirrors storage)
  const saveNewVersion = () => {
    const now = new Date().toISOString();
    const currNodes = nodes as WorkflowNode[];
    const currEdges = edges as WorkflowEdge[];
    const currentVersions: WorkflowVersion[] = Array.isArray(workflow.versions) ? [...workflow.versions] : [];
    const nextV = (currentVersions.length > 0 ? Math.max(...currentVersions.map(v => v.version)) : 0) + 1;
    const snap: WorkflowVersion = {
      version: nextV,
      name: workflow.name,
      nodes: JSON.parse(JSON.stringify(currNodes)),
      edges: JSON.parse(JSON.stringify(currEdges)),
      savedAt: now,
    };
    // avoid dup if identical last
    const last = currentVersions[currentVersions.length - 1];
    if (!last || JSON.stringify(last.nodes) !== JSON.stringify(snap.nodes) || JSON.stringify(last.edges) !== JSON.stringify(snap.edges)) {
      currentVersions.push(snap);
    }
    const capped = currentVersions.length > 10 ? currentVersions.slice(-10) : currentVersions;
    const updatedWf = { ...workflow, versions: capped, updatedAt: now };
    setWorkflow(updatedWf);
    if (!useApi) {
      localStorage.setItem(currentUser ? `n8nlike-workflow-${currentUser.id}` : "n8nlike-workflow", JSON.stringify(updatedWf));
    }
    toast.success(`Saved version v${nextV}`);
    return updatedWf;
  };

  const restoreVersion = (ver: WorkflowVersion) => {
    pushToHistory(nodes, edges);
    const restoredNodes = JSON.parse(JSON.stringify(ver.nodes)) as WorkflowNode[];
    const restoredEdges = JSON.parse(JSON.stringify(ver.edges)) as WorkflowEdge[];
    setNodes(restoredNodes);
    setEdges(restoredEdges);
    // Keep same id/name but update snapshot in wf
    const restoredWf: Workflow = {
      ...workflow,
      name: ver.name || workflow.name,
      nodes: restoredNodes,
      edges: restoredEdges,
      updatedAt: new Date().toISOString(),
    };
    setWorkflow(restoredWf);
    setSelectedNodeId(null);
    setExecution(null);
    setSelectedHistoryId(null);
    setNodeStatuses({});
    setOutputPreviews({});
    if (!useApi) {
      localStorage.setItem(currentUser ? `n8nlike-workflow-${currentUser.id}` : "n8nlike-workflow", JSON.stringify(restoredWf));
    } else {
      // Ensure persistence for restored version in API mode (update server)
      apiFetch(`/api/workflows/${encodeURIComponent(restoredWf.id)}`, {
        method: "PUT",
        body: JSON.stringify({ ...restoredWf, nodes: restoredNodes, edges: restoredEdges }),
      }).then(() => {
        loadWorkflowsFromApi().catch(() => {});
      }).catch(() => {
        toast.info("Restore applied locally (API persist failed)");
      });
    }
    setRightTab("versions");
    toast.success(`Restored v${ver.version} (${ver.savedAt.slice(0,10)})`);
  };

  // Delete a specific version (UI enhancement for versioning #6)
  const deleteVersion = (ver: WorkflowVersion) => {
    const kept = (workflow.versions || []).filter((v: WorkflowVersion) => v.version !== ver.version || v.savedAt !== ver.savedAt);
    const updated = { ...workflow, versions: kept };
    setWorkflow(updated);
    if (!useApi) {
      localStorage.setItem(currentUser ? `n8nlike-workflow-${currentUser.id}` : "n8nlike-workflow", JSON.stringify(updated));
    } else {
      apiFetch(`/api/workflows/${encodeURIComponent(workflow.id)}`, { method: "PUT", body: JSON.stringify({ ...updated }) }).catch(()=>{});
    }
    toast.info(`Deleted v${ver.version}`);
  };

  // Activation / Publishing model for triggers & scheduling (High Pri #4)
  // Uses `active` flag (server triggers + scheduler only run for active workflows). Also syncs isPublished for UI compat.
  const toggleActive = () => {
    const nextActive = !((workflow as any).active ?? (workflow as any).isPublished ?? false);
    const updated: Workflow = {
      ...workflow,
      active: nextActive,
      // keep legacy for display lists
      ...( (workflow as any).isPublished !== undefined ? { isPublished: nextActive } : {} ),
      updatedAt: new Date().toISOString(),
    } as Workflow;
    setWorkflow(updated);
    if (useApi) {
      // API save will call register/unregister in backend
      saveWorkflowToApi();
    } else {
      localStorage.setItem(currentUser ? `n8nlike-workflow-${currentUser.id}` : "n8nlike-workflow", JSON.stringify(updated));
    }
    toast.success(nextActive ? "Activated — triggers & schedules live (API)" : "Deactivated — triggers disabled");
  };

  // Versioning #6: explicit Draft vs Published toggle (separate from active for triggers)
  const togglePublish = () => {
    const currPub = !!((workflow as any).isPublished);
    const next = !currPub;
    const updated: Workflow = {
      ...workflow,
      isPublished: next,
      updatedAt: new Date().toISOString(),
    } as Workflow;
    setWorkflow(updated);
    if (useApi) {
      saveWorkflowToApi();
    } else {
      localStorage.setItem(currentUser ? `n8nlike-workflow-${currentUser.id}` : "n8nlike-workflow", JSON.stringify(updated));
    }
    if (next) {
      // snapshot a published version
      setTimeout(() => saveNewVersion(), 20);
    }
    toast.success(next ? "Published (version snapshot taken)" : "Set to Draft");
  };

  // Basic node grouping (Med-High #7) - uses RF parentNode + extent for nesting; reuses merge node as visual container to avoid new NodeType changes
  const groupSelectedNodes = () => {
    if (selectedNodeIds.length < 2) {
      toast.info("Select 2+ nodes (shift+click or drag select) to create group");
      return;
    }
    pushToHistory(nodes, edges);
    const selected = (nodes as any[]).filter((n: any) => selectedNodeIds.includes(n.id));
    const groupId = `group-${uuidv4().slice(0, 8)}`;
    const minX = Math.min(...selected.map((n: any) => n.position.x));
    const minY = Math.min(...selected.map((n: any) => n.position.y));
    const groupNode: WorkflowNode = {
      id: groupId,
      type: "merge",
      position: { x: minX - 12, y: minY - 44 },
      data: { label: `Group (${selected.length})`, parameters: { strategy: "group-container" } },
    };
    const childNodes = selected.map((n: any) => ({
      ...n,
      position: { x: Math.max(8, n.position.x - minX + 18), y: Math.max(8, n.position.y - minY + 18) },
      parentNode: groupId,
      extent: "parent" as const,
    }));
    const otherNodes = (nodes as any[]).filter((n: any) => !selectedNodeIds.includes(n.id));
    setNodes([...otherNodes, groupNode, ...childNodes]);
    setSelectedNodeId(groupId);
    setSelectedNodeIds([groupId]);
    toast.success(`Grouped ${selected.length} nodes (parent container)`);
  };

  // Basic "Convert to sub-workflow": save current as NEW wf (via api or local list sim), then replace canvas with sub ref node
  const convertToSubWorkflow = async () => {
    pushToHistory(nodes, edges);
    const subName = `${workflow.name} (sub)`;
    let subId = `wf-sub-${Date.now()}`;
    let subWf: Workflow | null = null;

    if (useApi) {
      try {
        const created = await apiFetch("/api/workflows", {
          method: "POST",
          body: JSON.stringify({ name: subName, nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) }),
        });
        subId = created.id;
        subWf = created;
        await loadWorkflowsFromApi();
      } catch (e: any) {
        toast.error("API create sub failed, using local ref: " + e.message);
      }
    } else {
      // local: just generate id, store a snapshot aside? for basic we just use id ref (data lives in export)
      subWf = { id: subId, name: subName, nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) };
    }

    // Now replace current canvas with single subWorkflow node referencing it
    const subNode: WorkflowNode = {
      id: `sub-${Date.now()}`,
      type: "subWorkflow",
      position: { x: 120, y: 180 },
      data: { label: "Sub: " + subName, parameters: { workflowId: subId } },
    };
    const emptyWf: Workflow = {
      id: `wf-${Date.now()}`,
      name: "Parent calling " + subName,
      nodes: [subNode],
      edges: [],
      isPublished: false,
      versions: [],
    };
    setWorkflow(emptyWf);
    setNodes([subNode]);
    setEdges([]);
    setSelectedNodeId(subNode.id);
    setExecution(null);
    setSelectedHistoryId(null);
    toast.success(`Converted to sub-workflow ref: ${subId}`);
    if (useApi && subWf) {
      // optionally load the sub as current? no, we created the caller
    }
  };

  // Enhanced save that also records a version
  const saveWorkflowWithVersion = () => {
    const base = saveWorkflow; // original
    // record version snapshot on explicit save
    saveNewVersion();
    // delegate to real save (api or local)
    if (useApi) {
      // re-call api save (will also version on server)
      saveWorkflowToApi();
    } else {
      const wf = { ...workflow, nodes, edges, updatedAt: new Date().toISOString(), versions: workflow.versions };
      localStorage.setItem(currentUser ? `n8nlike-workflow-${currentUser.id}` : "n8nlike-workflow", JSON.stringify(wf));
      setWorkflow(wf);
      toast.success("Saved locally + versioned");
    }
  };

  // Keyboard shortcuts (Task 5 polish) - stable via refs to avoid listener churn on state changes in deps
  const deleteSelectedRef = React.useRef(deleteSelected);
  const saveWorkflowRef = React.useRef(saveWorkflow);
  const runWorkflowRef = React.useRef(runWorkflow);
  const undoRef = React.useRef(undo);
  const redoRef = React.useRef(redo);
  React.useEffect(() => { deleteSelectedRef.current = deleteSelected; }, [deleteSelected]);
  React.useEffect(() => { saveWorkflowRef.current = saveWorkflow; }, [saveWorkflow]);
  React.useEffect(() => { runWorkflowRef.current = runWorkflow; }, [runWorkflow]);
  React.useEffect(() => { undoRef.current = undo; }, [undo]);
  React.useEffect(() => { redoRef.current = redo; }, [redo]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const isCtrlOrCmd = isMac ? e.metaKey : e.ctrlKey;

      if (e.key === "Delete" || e.key === "Backspace") {
        // only if not editing input/textarea
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        e.preventDefault();
        deleteSelectedRef.current();
      } else if (isCtrlOrCmd && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveWorkflowRef.current();
      } else if (isCtrlOrCmd && (e.key === "Enter" || e.key.toLowerCase() === "r")) {
        e.preventDefault();
        runWorkflowRef.current();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setSelectedNodeId(null);
        setSelectedNodeIds([]);
        setSelectedEdgeIds([]);
      } else if (isCtrlOrCmd && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undoRef.current();
      } else if ((isCtrlOrCmd && e.key.toLowerCase() === "y") || (isCtrlOrCmd && e.shiftKey && e.key.toLowerCase() === "z")) {
        e.preventDefault();
        redoRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []); // empty deps: stable listener, actions via refs (fixes churn)

  // Credential selector for nodes that support it (http, email w/ smtp, aiLlm, telegram, slack, db)
  const renderCredentialSelector = (supportedTypes: CredentialType[], currentCredId?: string) => {
    const filtered = credentials.filter((c) => supportedTypes.includes(c.type));
    return (
      <div className="pt-2 border-t border-[#2a2f38] mt-3">
        <div className="text-xs mb-1 flex items-center gap-1 text-[#8a909c]">
          <Key className="w-3 h-3" /> Credential (optional)
        </div>
        <select
          className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs"
          value={currentCredId || ""}
          onChange={(e) => updateSelectedNodeParams({ credentialId: e.target.value || undefined })}
        >
          <option value="">— None (use inline params) —</option>
          {filtered.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.type})
            </option>
          ))}
          {filtered.length === 0 && <option disabled>No matching credentials. Open manager to create.</option>}
        </select>
        <button
          onClick={() => setShowCredManager(true)}
          className="text-[10px] text-[#5c8df6] mt-1 hover:underline"
        >
          Manage credentials →
        </button>
      </div>
    );
  };

  // Simple parameter editor based on node type
  const renderParamEditor = () => {
    if (!selectedNode) {
      return (
        <div className="p-4 text-[#8a909c] text-sm">
          Select a node to edit its properties.
          <div className="mt-3">
            <button
              onClick={() => setShowCredManager(true)}
              className="flex items-center gap-1 text-xs px-2 py-1 bg-[#1f232b] hover:bg-[#2a2f38] rounded border border-[#2a2f38]"
            >
              <Key className="w-3 h-3" /> Open Credentials Manager
            </button>
          </div>
        </div>
      );
    }

    const type = selectedNode.type as NodeType;
    const params = selectedNode.data.parameters || {};

    if (type === "manualTrigger") {
      return (
        <div className="space-y-3 p-4">
          <div>
            <div className="text-xs text-[#8a909c] mb-1">Seed data (JSON)</div>
            <textarea
              className="w-full h-28 bg-[#0a0c10] border border-[#2a2f38] rounded p-2 text-xs font-mono"
              value={JSON.stringify(params.seedData ?? {}, null, 2)}
              onChange={(e) => {
                try {
                  const val = JSON.parse(e.target.value);
                  updateSelectedNodeParams({ seedData: val });
                } catch {}
              }}
            />
          </div>
        </div>
      );
    }

    if (type === "set") {
      const assignments = params.assignments || [];
      return (
        <div className="p-4 space-y-3">
          <div className="text-xs font-medium">Assignments</div>
          {assignments.map((a: any, idx: number) => (
            <div key={idx} className="flex gap-2">
              <input
                className="flex-1 bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs"
                placeholder="key"
                value={a.key || ""}
                onChange={(e) => {
                  const next = [...assignments];
                  next[idx] = { ...next[idx], key: e.target.value };
                  updateSelectedNodeParams({ assignments: next });
                }}
              />
              <input
                className="flex-1 bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs font-mono"
                placeholder="value or {{ $json.foo }}"
                value={a.value ?? ""}
                onChange={(e) => {
                  const next = [...assignments];
                  next[idx] = { ...next[idx], value: e.target.value };
                  updateSelectedNodeParams({ assignments: next });
                }}
              />
              <button
                onClick={() => {
                  const next = assignments.filter((_: any, i: number) => i !== idx);
                  updateSelectedNodeParams({ assignments: next });
                }}
                className="text-red-400 px-1"
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              updateSelectedNodeParams({
                assignments: [...assignments, { key: "newKey", value: "value" }],
              })
            }
            className="text-xs flex items-center gap-1 text-[#5c8df6]"
          >
            <Plus className="w-3 h-3" /> Add assignment
          </button>
        </div>
      );
    }

    if (type === "httpRequest") {
      return (
        <div className="p-4 space-y-3 text-sm">
          <div>
            <div className="text-xs mb-1">Method</div>
            <select
              className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs"
              value={params.method || "GET"}
              onChange={(e) => updateSelectedNodeParams({ method: e.target.value })}
            >
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-xs mb-1">URL</div>
            <input
              className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs font-mono"
              value={params.url || ""}
              onChange={(e) => updateSelectedNodeParams({ url: e.target.value })}
              placeholder="https://..."
            />
          </div>
          <div>
            <div className="text-xs mb-1">Body (JSON for POST etc.)</div>
            <textarea
              className="w-full h-20 bg-[#0a0c10] border border-[#2a2f38] rounded p-2 text-[10px] font-mono"
              value={params.body ? JSON.stringify(params.body, null, 2) : ""}
              onChange={(e) => {
                try {
                  updateSelectedNodeParams({ body: e.target.value ? JSON.parse(e.target.value) : null });
                } catch {}
              }}
            />
          </div>
          {renderCredentialSelector(["apiKey", "basicAuth", "oauth2", "generic"], params.credentialId)}
          <div className="text-[10px] text-[#8a909c] mt-1">Auth via cred (Bearer/Basic etc auto). Or inline: apiKey + headerName/prefix, username+password, accessToken.</div>
        </div>
      );
    }

    if (type === "if") {
      return (
        <div className="p-4 space-y-3 text-sm">
          <div>
            <div className="text-xs mb-1">Left (field path or value)</div>
            <input
              className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs font-mono"
              value={params.left || ""}
              onChange={(e) => updateSelectedNodeParams({ left: e.target.value })}
              placeholder="status or data.userId"
            />
          </div>
          <div>
            <div className="text-xs mb-1">Operator</div>
            <select
              className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs"
              value={params.operator || "equals"}
              onChange={(e) => updateSelectedNodeParams({ operator: e.target.value })}
            >
              <option value="equals">equals</option>
              <option value="notEquals">not equals</option>
              <option value="contains">contains</option>
              <option value="greaterThan">greater than</option>
              <option value="lessThan">less than</option>
            </select>
          </div>
          <div>
            <div className="text-xs mb-1">Right value</div>
            <input
              className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs"
              value={params.right ?? ""}
              onChange={(e) => updateSelectedNodeParams({ right: e.target.value })}
            />
          </div>
          <div className="text-[10px] text-[#8a909c] pt-1">Connect "true" and "false" handles on the right</div>
        </div>
      );
    }

    if (type === "code") {
      return (
        <div className="p-4">
          <div className="text-xs mb-1">JavaScript code</div>
          <div className="text-[10px] text-[#8a909c] mb-2">Receives <code>input</code> and <code>$json</code>. Return a value.</div>
          <textarea
            className="w-full h-36 bg-[#0a0c10] border border-[#2a2f38] rounded p-2 font-mono text-xs"
            value={params.code || ""}
            onChange={(e) => updateSelectedNodeParams({ code: e.target.value })}
          />
          <div className="text-[10px] mt-1 text-[#8a909c]">Example: <code>return {`{...input, ok: true}`}</code></div>
        </div>
      );
    }

    if (type === "webhookTrigger") {
      return (
        <div className="p-4 space-y-3">
          <div className="text-xs text-[#8a909c]">Test payload (used on execute / "fire")</div>
          <textarea
            className="w-full h-28 bg-[#0a0c10] border border-[#2a2f38] rounded p-2 text-xs font-mono"
            value={JSON.stringify(params.testPayload ?? {}, null, 2)}
            onChange={(e) => {
              try { updateSelectedNodeParams({ testPayload: JSON.parse(e.target.value) }); } catch {}
            }}
          />
          <div className="text-[10px] text-[#8a909c]">This node acts as a trigger. Use its payload as workflow start data.</div>
        </div>
      );
    }

    if (type === "scheduleTrigger") {
      return (
        <div className="p-4 space-y-3 text-sm">
          <div>
            <div className="text-xs mb-1">Cron expression</div>
            <input className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs font-mono" value={params.schedule || ""} onChange={(e) => updateSelectedNodeParams({ schedule: e.target.value })} placeholder="*/5 * * * *" />
          </div>
          <div>
            <div className="text-xs mb-1">Interval (human)</div>
            <input className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs" value={params.interval || ""} onChange={(e) => updateSelectedNodeParams({ interval: e.target.value })} placeholder="5m" />
          </div>
          <div className="text-[10px] text-[#8a909c]">Real server cron fires only when workflow is ACTIVE. Manual fire available in API mode.</div>
        </div>
      );
    }

    if (type === "formTrigger") {
      return (
        <div className="p-4 space-y-3 text-sm">
          <div>
            <div className="text-xs mb-1">Form fields (comma separated)</div>
            <input
              className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs"
              value={(params.fields || []).join(", ")}
              onChange={(e) => {
                const fields = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                updateSelectedNodeParams({ fields });
              }}
              placeholder="name, email, message"
            />
          </div>
          <div>
            <div className="text-xs mb-1">Optional secret (for auth on submit)</div>
            <input
              className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs font-mono"
              value={params.secret || params.authToken || ""}
              onChange={(e) => updateSelectedNodeParams({ secret: e.target.value })}
              placeholder="my-secret-token"
            />
          </div>
          <div className="text-[10px] text-[#8a909c]">POST JSON or form data to /api/forms/{workflow.id}. Active workflow required.</div>
        </div>
      );
    }

    if (type === "aiLlm") {
      return (
        <div className="p-4 space-y-3 text-sm">
          <div>
            <div className="text-xs mb-1">Prompt (supports {'{{ $json }}'} expressions)</div>
            <textarea className="w-full h-16 bg-[#0a0c10] border border-[#2a2f38] rounded p-2 text-xs" value={params.prompt || ""} onChange={(e) => updateSelectedNodeParams({ prompt: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-xs mb-1">Provider</div>
              <select className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs" value={params.provider || "openai"} onChange={(e) => updateSelectedNodeParams({ provider: e.target.value })}>
                <option value="openai">openai</option>
                <option value="anthropic">anthropic</option>
                <option value="gemini">gemini</option>
                <option value="ollama">ollama (local)</option>
              </select>
            </div>
            <div>
              <div className="text-xs mb-1">Model</div>
              <input className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs" value={params.model || ""} onChange={(e) => updateSelectedNodeParams({ model: e.target.value })} placeholder="gpt-4o-mini / claude-3-haiku..." />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="text-xs mb-1">Temperature</div>
              <input type="number" step="0.1" className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs" value={params.temperature ?? 0.7} onChange={(e) => updateSelectedNodeParams({ temperature: parseFloat(e.target.value) })} />
            </div>
            <div>
              <div className="text-xs mb-1">Max Tokens</div>
              <input type="number" className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs" value={params.maxTokens ?? 512} onChange={(e) => updateSelectedNodeParams({ maxTokens: parseInt(e.target.value) || 512 })} />
            </div>
            <div>
              <div className="text-xs mb-1">Inline Key (demo)</div>
              <input type="password" className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs" value={params.apiKey || ""} onChange={(e) => updateSelectedNodeParams({ apiKey: e.target.value })} placeholder="sk-..." />
            </div>
          </div>
          <div>
            <div className="text-xs mb-1">Tools (JSON array for tool calling / agents)</div>
            <textarea className="w-full h-12 bg-[#0a0c10] border border-[#2a2f38] rounded p-2 text-[10px] font-mono" value={typeof params.tools === "string" ? params.tools : (params.tools ? JSON.stringify(params.tools, null, 2) : "")} onChange={(e) => {
              try { const v = e.target.value.trim() ? JSON.parse(e.target.value) : undefined; updateSelectedNodeParams({ tools: v }); } catch { updateSelectedNodeParams({ tools: e.target.value }); }
            }} placeholder='[{"name":"lookup","description":"...","parameters":{"type":"object"}}]' />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-xs mb-1">Memory key (for history)</div>
              <input className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs" value={params.memoryKey || ""} onChange={(e) => updateSelectedNodeParams({ memoryKey: e.target.value })} placeholder="conv-123" />
            </div>
            <div className="flex items-end gap-2 text-xs">
              <label className="flex items-center gap-1"><input type="checkbox" checked={params.useMemory !== false} onChange={(e) => updateSelectedNodeParams({ useMemory: e.target.checked })} /> useMemory</label>
              <input className="flex-1 bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs" value={params.ragContext || ""} onChange={(e) => updateSelectedNodeParams({ ragContext: e.target.value })} placeholder="RAG context or {{ $node.X.json }}" />
            </div>
          </div>
          <div className="text-[10px] text-[#8a909c]">Real multi-LLM via cred/env. Tool calls returned for agent loops (use code node to dispatch to other nodes). Memory/RAG demo in-mem.</div>
          {renderCredentialSelector(["apiKey", "generic"], params.credentialId)}
        </div>
      );
    }

    if (type === "database") {
      return (
        <div className="p-4 space-y-2 text-sm">
          <div>
            <div className="text-xs mb-1">Operation</div>
            <select className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs" value={params.operation || "get"} onChange={(e) => updateSelectedNodeParams({ operation: e.target.value })}>
              <option value="get">get</option>
              <option value="set">set</option>
              <option value="query">query (all)</option>
            </select>
          </div>
          <div>
            <div className="text-xs mb-1">Key</div>
            <input className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs font-mono" value={params.key || ""} onChange={(e) => updateSelectedNodeParams({ key: e.target.value })} />
          </div>
          { (params.operation === "set") && (
            <div>
              <div className="text-xs mb-1">Value (JSON)</div>
              <textarea className="w-full h-16 bg-[#0a0c10] border border-[#2a2f38] rounded p-2 text-[10px] font-mono" value={typeof params.value === "object" ? JSON.stringify(params.value, null, 2) : (params.value || "")} onChange={(e) => {
                try { updateSelectedNodeParams({ value: JSON.parse(e.target.value) }); } catch { updateSelectedNodeParams({ value: e.target.value }); }
              }} />
            </div>
          )}
          <div className="text-[10px] text-[#8a909c]">Uses shared localStorage "n8nlike-db".</div>
          {renderCredentialSelector(["apiKey", "generic"], params.credentialId)}
        </div>
      );
    }

    if (type === "email") {
      return (
        <div className="p-4 space-y-3 text-sm">
          <div>
            <div className="text-xs mb-1">To</div>
            <input className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs" value={params.to || ""} onChange={(e) => updateSelectedNodeParams({ to: e.target.value })} placeholder="user@example.com" />
          </div>
          <div>
            <div className="text-xs mb-1">From</div>
            <input className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs" value={params.from || "onboarding@resend.dev"} onChange={(e) => updateSelectedNodeParams({ from: e.target.value })} />
          </div>
          <div>
            <div className="text-xs mb-1">Subject</div>
            <input className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs" value={params.subject || ""} onChange={(e) => updateSelectedNodeParams({ subject: e.target.value })} />
          </div>
          <div>
            <div className="text-xs mb-1">Body (supports {'{{ $json }}'})</div>
            <textarea className="w-full h-16 bg-[#0a0c10] border border-[#2a2f38] rounded p-2 text-xs font-mono" value={params.body || ""} onChange={(e) => updateSelectedNodeParams({ body: e.target.value })} />
          </div>
          <div>
            <div className="text-xs mb-1">Inline Resend/API Key (demo)</div>
            <input type="password" className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs" value={params.apiKey || params.resendApiKey || ""} onChange={(e) => updateSelectedNodeParams({ apiKey: e.target.value })} placeholder="re_..." />
          </div>
          <div className="text-[10px] text-[#8a909c]">Real via Resend (fetch) if key/cred; or SMTP (nodemailer server) via smtp* in smtp/generic cred. Dual mode.</div>
          {renderCredentialSelector(["basicAuth", "oauth2", "generic", "apiKey", "smtp"], params.credentialId)}
        </div>
      );
    }

    if (type === "telegram") {
      return (
        <div className="p-4 space-y-3 text-sm">
          <div>
            <div className="text-xs mb-1">Chat ID (or {'{{ expr }}'})</div>
            <input className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs font-mono" value={params.chatId || ""} onChange={(e) => updateSelectedNodeParams({ chatId: e.target.value })} placeholder="123456789 or {{ $json.chat }}" />
          </div>
          <div>
            <div className="text-xs mb-1">Text / Message (supports expressions)</div>
            <textarea className="w-full h-14 bg-[#0a0c10] border border-[#2a2f38] rounded p-2 text-xs font-mono" value={params.text || ""} onChange={(e) => updateSelectedNodeParams({ text: e.target.value })} />
          </div>
          <div>
            <div className="text-xs mb-1">Inline Bot Token (demo)</div>
            <input type="password" className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs" value={params.botToken || params.apiKey || ""} onChange={(e) => updateSelectedNodeParams({ botToken: e.target.value })} placeholder="123456:ABC..." />
          </div>
          <div className="text-[10px] text-[#8a909c]">Real sendMessage via Telegram Bot API. Use credentialId (apiKey) or env TELEGRAM_BOT_TOKEN on server.</div>
          {renderCredentialSelector(["apiKey", "generic"], params.credentialId)}
        </div>
      );
    }

    if (type === "slack") {
      return (
        <div className="p-4 space-y-3 text-sm">
          <div>
            <div className="text-xs mb-1">Channel</div>
            <input className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs" value={params.channel || "#general"} onChange={(e) => updateSelectedNodeParams({ channel: e.target.value })} />
          </div>
          <div>
            <div className="text-xs mb-1">Text (supports {'{{ $json }}'})</div>
            <textarea className="w-full h-14 bg-[#0a0c10] border border-[#2a2f38] rounded p-2 text-xs font-mono" value={params.text || ""} onChange={(e) => updateSelectedNodeParams({ text: e.target.value })} />
          </div>
          <div>
            <div className="text-xs mb-1">Webhook URL (preferred) or Token</div>
            <input className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs" value={params.webhookUrl || params.apiKey || ""} onChange={(e) => updateSelectedNodeParams({ webhookUrl: e.target.value })} placeholder="https://hooks.slack.com/..." />
          </div>
          <div className="text-[10px] text-[#8a909c]">Real Slack send (webhook or chat.postMessage). Credential supported.</div>
          {renderCredentialSelector(["apiKey", "generic", "oauth2"], params.credentialId)}
        </div>
      );
    }

    if (type === "loop") {
      return (
        <div className="p-4 space-y-3 text-sm">
          <div>
            <div className="text-xs mb-1">Iterations (1-5)</div>
            <input type="number" min={1} max={5} className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs" value={params.iterations ?? 3} onChange={(e) => updateSelectedNodeParams({ iterations: parseInt(e.target.value) || 1 })} />
          </div>
          <div>
            <div className="text-xs mb-1">Mode</div>
            <select className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs" value={params.mode || "count"} onChange={(e) => updateSelectedNodeParams({ mode: e.target.value })}>
              <option value="count">count</option>
              <option value="while">while (simulated)</option>
            </select>
          </div>
          <div className="text-[10px] text-[#8a909c]">Engine repeats connected downstream nodes N times (queue fan).</div>
        </div>
      );
    }

    if (type === "merge") {
      return (
        <div className="p-4 space-y-3 text-sm">
          <div>
            <div className="text-xs mb-1">Strategy</div>
            <select className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs" value={params.strategy || "combine"} onChange={(e) => updateSelectedNodeParams({ strategy: e.target.value })}>
              <option value="combine">combine (object)</option>
              <option value="array">array of branches</option>
              <option value="firstNonNull">first non-null</option>
            </select>
          </div>
          <div className="text-[10px] text-[#8a909c]">Connect 2+ branches into this node. Collects all incoming.</div>
        </div>
      );
    }

    if (type === "subWorkflow") {
      // Basic param UI for subflow ref
      const otherWfs = (useApi ? workflowsList : []).filter((w) => w.id !== workflow.id);
      return (
        <div className="p-4 space-y-3 text-sm">
          <div>
            <div className="text-xs text-[#8a909c] mb-1">Target Workflow ID (ref)</div>
            <input
              className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs font-mono"
              value={params.workflowId || ""}
              onChange={(e) => updateSelectedNodeParams({ workflowId: e.target.value })}
              placeholder="wf-xxx or select"
            />
          </div>
          {useApi && otherWfs.length > 0 && (
            <div>
              <div className="text-xs text-[#8a909c] mb-1">Quick select other wf</div>
              <select
                className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs"
                value={params.workflowId || ""}
                onChange={(e) => updateSelectedNodeParams({ workflowId: e.target.value })}
              >
                <option value="">-- pick --</option>
                {otherWfs.map((w) => (
                  <option key={w.id} value={w.id}>{w.name} ({w.id})</option>
                ))}
              </select>
            </div>
          )}
          <div className="text-[10px] text-[#8a909c]">Basic sub-workflow ref (High#6). On execute, passes items with _subWorkflowRef marker. Use "Convert to sub-workflow" button in left palette Templates. Reference other wf by ID; versions preserved on target.</div>
          <button onClick={() => { if (params.workflowId) { const target = workflowsList.find(w=>w.id===params.workflowId); if(target){ loadWorkflowByIdFromApi ? loadWorkflowByIdFromApi(params.workflowId) : toast.info("Load target via list or API"); } } else toast.info("Select a workflowId first"); }} className="text-[10px] mt-1 px-2 py-0.5 bg-[#1f232b] rounded border border-[#2a2f38]">Load referenced wf (demo)</button>
        </div>
      );
    }

    // Fallback generic editor for any unhandled / future node types (prevents blank inspector)
    return (
      <div className="p-4 space-y-3 text-sm">
        <div className="text-xs text-[#8a909c]">Parameters (JSON)</div>
        <textarea
          className="w-full h-40 bg-[#0a0c10] border border-[#2a2f38] rounded p-2 text-[10px] font-mono"
          value={JSON.stringify(params, null, 2)}
          onChange={(e) => {
            try {
              const val = JSON.parse(e.target.value);
              // push removed here too (avoids flood on typing in generic JSON editor)
              // replace whole params
              setNodes((nds) => nds.map(n => n.id === selectedNodeId ? { ...n, data: { ...n.data, parameters: val } } : n ));
            } catch {}
          }}
        />
        <div className="text-[10px] text-[#8a909c]">Advanced: edit raw. Prefer specific fields when available.</div>
      </div>
    );
  };

  if (!isClient) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0f1115] text-[#8a909c]">
        Loading n8nlike editor…
      </div>
    );
  }

  // Auth gate: show simple demo login/signup before editor (enables per-user isolation)
  if (isAuthLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0f1115] text-[#8a909c]">
        Checking session…
      </div>
    );
  }
  if (!currentUser || showAuth) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0f1115] text-[#e6e8ec]">
        <div className="w-full max-w-md rounded-xl border border-[#2a2f38] bg-[#16181f] p-8 shadow-2xl">
          <div className="mb-6 text-center">
            <div className="text-3xl font-semibold tracking-tight"><span className="text-[#ff6d5a]">n8n</span>like</div>
            <div className="text-xs text-[#8a909c] mt-1">Demo Auth + Multi-Tenancy (MVP)</div>
          </div>

          <div className="flex gap-2 mb-4">
            <button onClick={() => { setAuthMode("login"); setAuthError(null); }} className={`flex-1 py-1.5 rounded text-sm ${authMode === "login" ? "bg-[#ff6d5a] text-white" : "bg-[#1f232b]"}`}>Log in</button>
            <button onClick={() => { setAuthMode("signup"); setAuthError(null); }} className={`flex-1 py-1.5 rounded text-sm ${authMode === "signup" ? "bg-[#ff6d5a] text-white" : "bg-[#1f232b]"}`}>Sign up</button>
          </div>

          <form onSubmit={authMode === "login" ? handleLogin : handleSignup} className="space-y-3">
            {authMode === "signup" && (
              <input value={authName} onChange={(e) => setAuthName(e.target.value)} placeholder="Name (optional)" className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-3 py-2 text-sm" />
            )}
            <input value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} type="email" placeholder="Email (try demo@n8nlike.local)" required className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-3 py-2 text-sm" />
            <input value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} type="password" placeholder="Password (demo: demo)" required className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-3 py-2 text-sm" />

            {authError && <div className="text-red-400 text-xs">{authError}</div>}

            <button type="submit" disabled={isAuthOp} className="w-full py-2 rounded bg-[#ff6d5a] hover:bg-[#e55a47] text-sm font-medium disabled:opacity-60">
              {isAuthOp ? "Please wait..." : (authMode === "login" ? "Log in" : "Create account")}
            </button>
          </form>

          <div className="mt-4 text-[10px] text-center text-[#6b7280]">
            Demo only. Accounts stored in data/users.json. Use “demo / demo” or sign up any email.
            <br />All data (workflows, creds, executions) isolated per user.
          </div>

          <button onClick={() => { /* quick demo login without form */ setAuthEmail("demo@n8nlike.local"); setAuthPassword("demo"); handleLogin(); }} className="mt-3 w-full text-[10px] py-1 text-[#8a909c] hover:text-white">Quick demo login (demo/demo)</button>

          {/* Backward compat: local/demo no-auth mode (skips server session, forces local, no cross-reload persist) */}
          <button
            onClick={() => {
              const demoUser: User = { id: "demo-local", email: "demo@local", name: "Local Demo (no auth)" };
              setCurrentUser(demoUser);
              setUseApi(false);
              setIsAuthLoading(false);
              setShowAuth(false);
              toast.info("Entered local demo mode (no server auth/ persistence for this session)");
            }}
            className="mt-2 w-full text-[10px] py-1 text-[#8a909c] hover:text-[#5c8df6] border border-[#2a2f38] rounded"
          >
            Use local demo (no login, no API)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="n8nlike flex h-screen flex-col overflow-hidden bg-[#0f1115] text-[#e6e8ec]">
      {/* Top Bar */}
      <div className="flex h-14 items-center justify-between border-b border-[#2a2f38] bg-[#16181f] px-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 font-semibold tracking-tight text-xl">
            <span className="text-[#ff6d5a]">n8n</span>like
          </div>
          <div className="text-xs px-2 py-0.5 bg-[#1f232b] rounded text-[#8a909c]">MVP</div>
          <div className="text-[10px] text-[#6b7280]">v0.5</div>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <input
            value={workflow.name}
            onChange={(e) => setWorkflow({ ...workflow, name: e.target.value })}
            className="bg-transparent border border-[#2a2f38] rounded px-3 py-1 text-sm w-56 focus:outline-none focus:border-[#ff6d5a]"
          />

          {/* Activation toggle: Production-Grade Triggers & Scheduling (active/inactive flag) */}
          <button
            onClick={toggleActive}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] border ${((workflow as any).active ?? (workflow as any).isPublished) ? "bg-emerald-950 border-emerald-600 text-emerald-400" : "bg-[#1f232b] border-[#2a2f38] text-[#8a909c]"}`}
            title={((workflow as any).active ?? (workflow as any).isPublished) ? "ACTIVE — webhooks, schedules, forms will trigger (server)" : "INACTIVE — triggers disabled. Click to activate/publish"}
          >
            {((workflow as any).active ?? (workflow as any).isPublished) ? <Power className="w-3 h-3" /> : <ToggleLeft className="w-3 h-3" />}
            {((workflow as any).active ?? (workflow as any).isPublished) ? "ACTIVE" : "INACTIVE"}
          </button>

          {/* Versioning #6: Publish/Draft toggle (in workflow manager area) */}
          <button
            onClick={togglePublish}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] border ${((workflow as any).isPublished) ? "bg-[#5c8df6] border-[#5c8df6] text-black" : "bg-[#1f232b] border-[#2a2f38] text-[#8a909c]"}`}
            title={((workflow as any).isPublished) ? "PUBLISHED — released version (safe to use in prod triggers)" : "DRAFT — editing in progress. Click to publish & snapshot version"}
          >
            {((workflow as any).isPublished) ? "PUBLISHED" : "DRAFT"}
          </button>

          {/* API / Local mode toggle + Workflow switcher */}
          <button
            onClick={async () => {
              const next = !useApi;
              setUseApi(next);
              if (next) {
                // On switch to API, merge any server-side executions (webhook/schedule) into history for visibility
                try {
                  const serverHist = await loadExecutionsFromApi();
                  if (serverHist.length) {
                    setExecutions((prev) => {
                      const ids = new Set(prev.map((p: any) => p.id));
                      const merged = [...serverHist.filter((s: any) => !ids.has(s.id)), ...prev];
                      return merged.slice(0, 50);
                    });
                  }
                } catch {}
              }
            }}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] border transition-colors ${useApi ? "bg-[#1f232b] border-[#5c8df6] text-[#5c8df6]" : "bg-[#1f232b] border-[#2a2f38] text-[#8a909c] hover:border-[#ff6d5a]"}`}
            title={useApi ? "API mode (persisted on server)" : "Local mode (browser only)"}
          >
            {useApi ? <Server className="w-3 h-3" /> : <HardDrive className="w-3 h-3" />}
            {useApi ? "API" : "LOCAL"}
          </button>

          {/* Credentials button (CRED feature) */}
          <button
            onClick={() => setShowCredManager(true)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] border bg-[#1f232b] border-[#2a2f38] hover:border-[#5c8df6] text-[#8a909c]"
            title="Manage Credentials / Connections (API keys, auth)"
          >
            <Key className="w-3 h-3" /> Creds ({credentials.length})
          </button>

          {/* Templates modal trigger (Future #6) */}
          <button
            onClick={() => setShowTemplatesModal(true)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] border bg-[#1f232b] border-[#2a2f38] hover:border-[#5c8df6] text-[#8a909c]"
            title="Open Templates modal - import sample workflows (JSON)"
          >
            <BookOpen className="w-3 h-3" /> Templates
          </button>

          {useApi && (
            <>
              <select
                value={workflow.id}
                onChange={(e) => {
                  const id = e.target.value;
                  if (id && id !== workflow.id) {
                    loadWorkflowByIdFromApi(id);
                  }
                }}
                disabled={isLoadingWorkflows || isApiOperation}
                className="bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs max-w-[180px] focus:outline-none focus:border-[#5c8df6]"
                title="Switch workflow (loaded from API)"
              >
                {workflowsList.length === 0 && <option value={workflow.id}>{workflow.name}</option>}
                {workflowsList.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} {(w as any).isPublished ? "📘" : "✏️"} {(w as any).active || (w as any).isPublished ? "●" : "○"} {w.id === workflow.id ? "•" : ""}
                  </option>
                ))}
              </select>
              <button
                onClick={createNewWorkflowViaApi}
                disabled={isApiOperation}
                className="flex items-center gap-1 rounded bg-[#1f232b] hover:bg-[#2a2f38] px-2 py-1 text-[10px]"
                title="Create new workflow on server"
              >
                <Plus className="w-3 h-3" /> New
              </button>
              <button
                onClick={deleteCurrentWorkflowViaApi}
                disabled={isApiOperation || !workflow.id}
                className="flex items-center gap-1 rounded bg-red-950/30 hover:bg-red-950/50 px-1.5 py-1 text-[10px] text-red-400"
                title="Delete this workflow from server"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </>
          )}

          {/* User / Auth (multi-tenancy indicator) */}
          {currentUser && (
            <div className="flex items-center gap-1.5 text-xs px-2 py-0.5 bg-[#1f232b] rounded border border-[#2a2f38]">
              <span className="text-[#8a909c]">👤</span>
              <span title={currentUser.id} className="max-w-[120px] truncate">{currentUser.name || currentUser.email}</span>
              <button onClick={handleLogout} className="ml-1 text-[#8a909c] hover:text-red-400 text-[10px]" title="Logout">×</button>
            </div>
          )}

          {/* Mini last run status indicator */}
          {lastExecution && (
            <div
              onClick={() => {
                setRightTab("history");
                setSelectedHistoryId(lastExecution.id);
              }}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] cursor-pointer border ${
                lastExecution.success
                  ? "text-emerald-400 border-emerald-900/50 bg-emerald-950/30"
                  : "text-red-400 border-red-900/50 bg-red-950/30"
              }`}
              title="Click to view in history"
            >
              <div className={`w-1.5 h-1.5 rounded-full ${lastExecution.success ? "bg-emerald-400" : "bg-red-400"}`} />
              LAST: {lastExecution.success ? "OK" : "FAIL"} {lastExecution.finishedAt ? `· ${Math.round((new Date(lastExecution.finishedAt).getTime() - new Date(lastExecution.startedAt).getTime()) / 10) / 100}s` : ""}
            </div>
          )}
          <button onClick={saveWorkflow} disabled={isApiOperation} className="flex items-center gap-1.5 rounded bg-[#1f232b] hover:bg-[#2a2f38] px-3 py-1.5 text-xs disabled:opacity-60" title="Ctrl/Cmd + S">
            <Save className="w-3.5 h-3.5" /> {useApi ? "Save" : "Save"}
          </button>
          {/* Undo / Redo polish */}
          <button onClick={undo} disabled={historyIndex <= 0} className="flex items-center gap-1 rounded bg-[#1f232b] hover:bg-[#2a2f38] px-2 py-1.5 text-xs disabled:opacity-50" title="Undo (Ctrl/Cmd+Z)">
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={redo} disabled={historyIndex >= historyStack.length - 1} className="flex items-center gap-1 rounded bg-[#1f232b] hover:bg-[#2a2f38] px-2 py-1.5 text-xs disabled:opacity-50" title="Redo (Ctrl/Cmd+Shift+Z or Y)">
            <Redo2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={deleteSelected} disabled={selectedNodeIds.length === 0 && !selectedNodeId && selectedEdgeIds.length === 0} className="flex items-center gap-1 rounded bg-[#1f232b] hover:bg-red-950/40 px-2 py-1.5 text-xs text-red-400 disabled:opacity-50" title="Delete selected (Del / Backspace)">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowCredManager(true)}
            className="flex items-center gap-1.5 rounded bg-[#1f232b] hover:bg-[#2a2f38] border border-[#2a2f38] px-3 py-1.5 text-xs"
            title="Manage credentials / connections"
          >
            <Key className="w-3.5 h-3.5" /> Credentials
            {credentials.length > 0 && <span className="opacity-60">({credentials.length})</span>}
          </button>
          <button onClick={() => runWorkflow()} disabled={isRunning} className="flex items-center gap-1.5 rounded bg-[#ff6d5a] hover:bg-[#f55c46] px-4 py-1.5 text-xs font-medium text-black disabled:opacity-60" title="Ctrl/Cmd + Enter or R (client exec)">
            {isRunning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} 
            {isRunning ? "Running..." : "Execute Workflow"}
          </button>
          {/* Real server trigger fire (High Pri #4) - uses webhook API path with rich data, works for schedule/webhook/form */}
          <button
            onClick={fireSelectedTrigger}
            disabled={isRunning || !useApi}
            className="flex items-center gap-1.5 rounded bg-[#1f232b] hover:bg-[#2a2f38] border border-[#5c8df6] text-[#5c8df6] px-3 py-1.5 text-xs disabled:opacity-50"
            title="Fire real server-side trigger (webhook API). Requires API mode + active workflow. Reliable cron/webhook execution path."
          >
            <Webhook className="w-3.5 h-3.5" /> Fire (server)
          </button>
          <button onClick={clearWorkflow} className="flex items-center gap-1.5 rounded bg-[#1f232b] hover:bg-red-950/40 px-3 py-1.5 text-xs text-red-400">
            <Trash2 className="w-3.5 h-3.5" /> Clear
          </button>
          <button onClick={exportWorkflow} className="flex items-center gap-1.5 rounded bg-[#1f232b] hover:bg-[#2a2f38] px-3 py-1.5 text-xs">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          <button onClick={importWorkflow} className="flex items-center gap-1.5 rounded bg-[#1f232b] hover:bg-[#2a2f38] px-3 py-1.5 text-xs">
            <Upload className="w-3.5 h-3.5" /> Import
          </button>
          <button
            onClick={() => {
              const example: Workflow = {
                id: "wf-example-" + Date.now(),
                name: "Schedule + AI + Loop + Email + DB",
                nodes: [
                  { id: "sched", type: "scheduleTrigger", position: { x: 40, y: 160 }, data: { label: "Daily Trigger", parameters: { schedule: "0 9 * * *", interval: "daily" } } },
                  { id: "ai", type: "aiLlm", position: { x: 260, y: 160 }, data: { label: "AI Summarize", parameters: { prompt: "Summarize the provided data concisely and output sentiment.", model: "gpt-4o-mini" } } },
                  { id: "loop", type: "loop", position: { x: 500, y: 100 }, data: { label: "Repeat 3x", parameters: { iterations: 3, mode: "count" } } },
                  { id: "email", type: "email", position: { x: 720, y: 100 }, data: { label: "Send Report", parameters: { to: "team@example.com", subject: "Daily AI Report", body: "Report ready: {{ $json }}" } } },
                  { id: "db", type: "database", position: { x: 500, y: 260 }, data: { label: "Log to DB", parameters: { operation: "set", key: "lastSummary", value: { ranAt: "now" } } } },
                ],
                edges: [
                  { id: "e1", source: "sched", target: "ai", sourceHandle: "main", targetHandle: "in" },
                  { id: "e2", source: "ai", target: "loop", sourceHandle: "main", targetHandle: "in" },
                  { id: "e3", source: "loop", target: "email", sourceHandle: "main", targetHandle: "in" },
                  { id: "e4", source: "ai", target: "db", sourceHandle: "main", targetHandle: "in" },
                ],
                isPublished: false,
                versions: [],
              };
              pushToHistory(nodes, edges);
              setWorkflow(example);
              setNodes(example.nodes);
              setEdges(example.edges);
              setSelectedNodeId(null);
              setExecution(null);
              setSelectedHistoryId(null);
              setNodeStatuses({});
              setOutputPreviews({});
              toast.success("Loaded example workflow");
            }}
            className="flex items-center gap-1.5 rounded bg-[#1f232b] hover:bg-[#2a2f38] px-3 py-1.5 text-xs"
          >
            Load Example
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Palette */}
        <div className="w-56 border-r border-[#2a2f38] bg-[#16181f] p-3 overflow-auto">
          <div className="mb-1.5 px-1 flex items-center gap-1 text-[11px] font-semibold tracking-wider text-[#8a909c]">
            <Plus className="w-3 h-3" /> NODES
          </div>

          {/* Palette search / filter */}
          <div className="mb-2 px-1 relative">
            <input
              type="text"
              value={paletteFilter}
              onChange={(e) => setPaletteFilter(e.target.value)}
              placeholder="Search nodes..."
              className="w-full bg-[#0a0c10] border border-[#2a2f38] text-xs rounded pl-7 py-1 focus:outline-none focus:border-[#ff6d5a]"
            />
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#8a909c]" />
            {paletteFilter && (
              <button onClick={() => setPaletteFilter("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8a909c] hover:text-white" title="Clear"><X className="w-3 h-3" /></button>
            )}
          </div>

          <div className="space-y-1.5">
            {nodeTypesList
              .filter((def) =>
                !paletteFilter ||
                def.label.toLowerCase().includes(paletteFilter.toLowerCase()) ||
                def.description.toLowerCase().includes(paletteFilter.toLowerCase()) ||
                def.type.toLowerCase().includes(paletteFilter.toLowerCase())
              )
              .map((def) => (
                <div
                  key={def.type}
                  draggable
                  onDragStart={(e) => onDragStart(e, def.type)}
                  onClick={() => addNode(def.type)}
                  className="palette-item"
                  title={def.description}
                >
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: def.color }} />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{def.label}</div>
                    <div className="text-[10px] text-[#8a909c] truncate">{def.description}</div>
                  </div>
                </div>
              ))}
          </div>

          {/* Templates gallery / browser (curated importable JSON) */}
          <div className="mt-4 px-1 border-t border-[#2a2f38] pt-3">
            <div className="flex items-center gap-1 text-[10px] uppercase text-[#8a909c] mb-1.5">
              <BookOpen className="w-3 h-3" /> TEMPLATES
            </div>
            <div className="space-y-1">
              {TEMPLATES.map((tpl, idx) => (
                <button
                  key={idx}
                  onClick={() => loadTemplate(tpl)}
                  className="w-full text-left px-2 py-1 text-xs rounded bg-[#0a0c10] hover:bg-[#1f232b] border border-[#2a2f38] hover:border-[#3a404c] flex flex-col"
                  title={tpl.description}
                >
                  <div className="font-medium truncate text-[#c5c9d0]">{tpl.name}</div>
                  <div className="text-[9px] text-[#8a909c] truncate">{tpl.description}</div>
                </button>
              ))}
              <button
                onClick={convertToSubWorkflow}
                className="w-full mt-1 text-left px-2 py-1 text-[10px] rounded bg-[#1f232b] hover:bg-[#2a2f38] border border-[#3a404c] text-[#8a909c]"
                title="Convert current workflow into a sub-workflow reference (basic)"
              >
                Convert to sub-workflow →
              </button>
            </div>
            <div className="text-[9px] text-[#6b7280] mt-1">Click to load / import. Use Export for full JSON.</div>
          </div>

          <div className="mt-8 px-1">
            <div className="text-[10px] uppercase text-[#8a909c] mb-1.5">How to use</div>
            <ul className="text-xs text-[#8a909c] space-y-1 pl-1">
              <li>• Drag or click nodes from palette</li>
              <li>• Click / shift-select on canvas</li>
              <li>• Drag handles to connect (true/false labeled)</li>
              <li>• Keyboard: Del remove, ⌘S save, ⌘Enter run, ⌘Z undo, Esc</li>
            </ul>
          </div>

          <div className="mt-auto pt-8 px-1 text-[10px] text-[#8a909c]">
            Data flows left → right.<br />
            IF true/false. Sub-workflow ref node supported (basic). See Templates + Versions tab.
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 relative" onDragOver={onDragOver} onDrop={onDrop}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneContextMenu={onPaneContextMenu}
            onNodeContextMenu={onNodeContextMenu}
            onEdgeContextMenu={onEdgeContextMenu}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onInit={setRfInstance}
            fitView
            snapToGrid={true}
            snapGrid={[18, 18]}
            proOptions={{ hideAttribution: true }}
            className={`bg-[#0f1115] ${isRunning ? "executing" : ""}`}
          >
            <Background color="#232831" gap={18} />
            <Controls />
            <MiniMap nodeStrokeWidth={2} nodeColor="#3b414d" maskColor="#0f111580" />

            {/* Context menu (right-click on canvas/node/edge) - enhanced for #7 */}
            {contextMenu && (
              <div
                style={{ left: contextMenu.x - 180, top: contextMenu.y - 80, position: 'fixed', zIndex: 60 }}
                className="bg-[#16181f] border border-[#2a2f38] rounded shadow-lg text-xs w-44 py-1"
                onMouseLeave={closeContext}
              >
                <div className="px-2 py-0.5 text-[#8a909c] border-b border-[#2a2f38] text-[10px]">{contextMenu.nodeId ? "Node Menu" : contextMenu.edgeId ? "Edge Menu" : "Canvas Menu"}</div>
                {!contextMenu.nodeId && !contextMenu.edgeId && (
                  <>
                    <button onClick={() => handleContextAction("add-set")} className="w-full text-left px-3 py-1 hover:bg-[#2a2f38]">+ Add Set</button>
                    <button onClick={() => handleContextAction("add-if")} className="w-full text-left px-3 py-1 hover:bg-[#2a2f38]">+ Add If</button>
                    <button onClick={() => handleContextAction("add-http")} className="w-full text-left px-3 py-1 hover:bg-[#2a2f38]">+ Add HTTP</button>
                    <button onClick={() => handleContextAction("add-code")} className="w-full text-left px-3 py-1 hover:bg-[#2a2f38]">+ Add Code</button>
                    <div className="border-t border-[#2a2f38] my-0.5" />
                  </>
                )}
                <button onClick={() => handleContextAction("layout")} className="w-full text-left px-3 py-1 hover:bg-[#2a2f38]">↻ Auto Layout</button>
                <button onClick={() => handleContextAction("group")} className="w-full text-left px-3 py-1 hover:bg-[#2a2f38]">📦 Group Selected</button>
                {contextMenu.nodeId && (
                  <button onClick={() => handleContextAction("ungroup")} className="w-full text-left px-3 py-1 hover:bg-[#2a2f38]">Ungroup / Remove Box</button>
                )}
                {(contextMenu.nodeId || contextMenu.edgeId) && (
                  <button onClick={() => handleContextAction("delete")} className="w-full text-left px-3 py-1 hover:bg-red-950/40 text-red-400">🗑 Delete</button>
                )}
                <button onClick={closeContext} className="w-full text-left px-3 py-1 text-[#8a909c] hover:bg-[#2a2f38]">Close</button>
              </div>
            )}

            {/* Polished controls floating inside flow */}
            <Panel position="top-right" className="flex gap-1 m-2">
              <button
                onClick={() => rfInstance?.fitView({ padding: 0.2, duration: 200 })}
                className="px-2 py-1 text-[10px] bg-[#1f232b] hover:bg-[#2a2f38] border border-[#2a2f38] rounded flex items-center gap-1"
                title="Fit view (also in controls)"
              >
                <Maximize2 className="w-3 h-3" /> Fit
              </button>
              <button
                onClick={() => {
                  // Better auto-layout (layered by connections, no new deps; Future #7)
                  pushToHistory(nodes, edges);
                  const nodeList = nodes as any[];
                  const edgeList = edges as any[];
                  const adj = new Map<string, string[]>();
                  const indegree = new Map<string, number>();
                  nodeList.forEach(n => { adj.set(n.id, []); indegree.set(n.id, 0); });
                  edgeList.forEach((e: any) => {
                    if (adj.has(e.source)) adj.get(e.source)!.push(e.target);
                    indegree.set(e.target, (indegree.get(e.target) || 0) + 1);
                  });
                  // Kahn-like layering
                  let queue: string[] = nodeList.filter(n => (indegree.get(n.id) || 0) === 0).map(n => n.id);
                  const levels: string[][] = [];
                  let lvl = 0;
                  const visited = new Set<string>();
                  while (queue.length > 0) {
                    levels[lvl] = [...queue];
                    const nextQ: string[] = [];
                    queue.forEach(id => {
                      visited.add(id);
                      (adj.get(id) || []).forEach(t => {
                        indegree.set(t, (indegree.get(t) || 0) - 1);
                        if ((indegree.get(t) || 0) === 0) nextQ.push(t);
                      });
                    });
                    queue = nextQ;
                    lvl++;
                  }
                  // leftover disconnected to end
                  const remaining = nodeList.filter(n => !visited.has(n.id)).map(n => n.id);
                  if (remaining.length) levels.push(remaining);
                  const posMap: Record<string, {x:number,y:number}> = {};
                  levels.forEach((lev, l) => {
                    // improved spacing + center clusters a bit
                    lev.forEach((id, i) => { posMap[id] = { x: 90 + l * 260, y: 70 + i * 120 }; });
                  });
                  setNodes((nds: any[]) => (nds as any[]).map(n => {
                    // clear grouping on full auto-layout for clean result
                    const p = posMap[n.id] || n.position;
                    return { ...n, position: p, parentNode: undefined, extent: undefined };
                  }));
                  toast.info("Auto layout applied (layered + snap-friendly)");
                }}
                className="px-2 py-1 text-[10px] bg-[#1f232b] hover:bg-[#2a2f38] border border-[#2a2f38] rounded flex items-center gap-1"
                title="Better auto layout (connection layers)"
              >
                <LayoutDashboard className="w-3 h-3" /> Layout
              </button>
            </Panel>

            {/* Node/Edge toolbar for #7 (visible when items selected) */}
            {(selectedNodeIds.length > 0 || selectedEdgeIds.length > 0) && (
              <Panel position="top-left" className="m-2 flex gap-1 bg-[#16181f] border border-[#2a2f38] rounded px-1 py-0.5 text-[10px] shadow">
                {selectedNodeIds.length > 0 && (
                  <>
                    <button onClick={() => { pushToHistory(nodes, edges); setNodes(nds => (nds as any[]).filter(n => !selectedNodeIds.includes(n.id))); setSelectedNodeIds([]); }} className="px-1.5 py-0.5 hover:bg-red-950/40 text-red-400 rounded" title="Delete selected">Del</button>
                    {selectedNodeIds.length > 1 && <button onClick={groupSelectedNodes} className="px-1.5 py-0.5 hover:bg-[#2a2f38] rounded" title="Group selected nodes">Group</button>}
                  </>
                )}
                {selectedEdgeIds.length > 0 && (
                  <button onClick={() => { setEdges(eds => (eds as any[]).filter(e => !selectedEdgeIds.includes(e.id))); setSelectedEdgeIds([]); }} className="px-1.5 py-0.5 hover:bg-red-950/40 text-red-400 rounded">Del Edge</button>
                )}
                <button onClick={() => { setSelectedNodeIds([]); setSelectedEdgeIds([]); }} className="px-1 py-0.5 text-[#8a909c] hover:text-white" title="Clear selection">×</button>
              </Panel>
            )}
          </ReactFlow>

          {/* Floating hint */}
          <div className="absolute bottom-4 right-4 text-[10px] text-[#8a909c] bg-[#16181f]/80 px-2 py-0.5 rounded">
            {nodes.length} nodes • {edges.length} connections
          </div>
        </div>

        {/* Right Sidebar: Inspector / History tabs */}
        <div className="w-80 border-l border-[#2a2f38] bg-[#16181f] flex flex-col overflow-hidden">
          {/* Tab switcher - Inspector | Logs | History (collapsible tabs polish) */}
          <div className="flex border-b border-[#2a2f38] text-sm">
            <button
              onClick={() => setRightTab("inspector")}
              className={`flex-1 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                rightTab === "inspector" ? "border-[#ff6d5a] text-white" : "border-transparent text-[#8a909c] hover:text-[#c5c9d0]"
              }`}
              title="Node properties"
            >
              Inspector
            </button>
            <button
              onClick={() => setRightTab("logs")}
              className={`flex-1 px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center justify-center gap-1 ${
                rightTab === "logs" ? "border-[#ff6d5a] text-white" : "border-transparent text-[#8a909c] hover:text-[#c5c9d0]"
              }`}
              title="Live execution log"
            >
              <Clock className="w-3 h-3" /> Logs
              {execution && <span className="text-[9px] opacity-60">•</span>}
            </button>
            <button
              onClick={() => setRightTab("history")}
              className={`flex-1 px-3 py-2 text-xs font-medium border-b-2 flex items-center justify-center gap-1 transition-colors ${
                rightTab === "history" ? "border-[#ff6d5a] text-white" : "border-transparent text-[#8a909c] hover:text-[#c5c9d0]"
              }`}
              title="Past executions & replay"
            >
              <History className="w-3 h-3" /> History
              {executions.length > 0 && <span className="text-[10px] opacity-60">({executions.length})</span>}
            </button>
            <button
              onClick={() => setRightTab("versions")}
              className={`flex-1 px-3 py-2 text-xs font-medium border-b-2 flex items-center justify-center gap-1 transition-colors ${
                rightTab === "versions" ? "border-[#ff6d5a] text-white" : "border-transparent text-[#8a909c] hover:text-[#c5c9d0]"
              }`}
              title="Workflow version history & restore"
            >
              <RotateCcw className="w-3 h-3" /> Versions
              {(workflow.versions?.length || 0) > 0 && <span className="text-[10px] opacity-60">({workflow.versions?.length})</span>}
            </button>
            <button
              onClick={() => setRightTab("credentials")}
              className={`flex-1 px-3 py-2 text-xs font-medium border-b-2 flex items-center justify-center gap-1 transition-colors ${
                rightTab === "credentials" ? "border-[#ff6d5a] text-white" : "border-transparent text-[#8a909c] hover:text-[#c5c9d0]"
              }`}
              title="Manage credentials / connections (Future #1)"
            >
              <Key className="w-3 h-3" /> Creds
              {credentials.length > 0 && <span className="text-[10px] opacity-60">({credentials.length})</span>}
            </button>
          </div>

          {rightTab === "inspector" && (
            <div className="flex-1 overflow-auto">
              {renderParamEditor()}
              {!selectedNode && (
                <div className="p-3 text-[10px] text-[#8a909c] border-t border-[#2a2f38]">
                  Multi-select nodes on canvas (shift/click-drag) • Use Delete key or toolbar for bulk ops.
                </div>
              )}
            </div>
          )}

          {rightTab === "logs" && (
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="px-3 py-2 flex items-center justify-between border-b border-[#2a2f38] bg-[#1a1d24] flex-shrink-0">
                <div className="text-xs font-medium">EXECUTION LOG (LIVE)</div>
                {execution && (
                  <div className={`text-xs ${execution.success ? "text-emerald-400" : "text-red-400"}`}>
                    {execution.success ? "SUCCESS" : "FAILED"}
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-auto p-3 execution-log text-[#a1a6b0]">
                {!execution && <div className="text-xs opacity-60">Run the workflow to see results here.</div>}

                {execution && (
                  <div className="space-y-2">
                    {execution.results.map((r, idx) => {
                      const hasError = !!r.error;
                      const isExpanded = expandedLiveSteps.has(idx);
                      return (
                        <div
                          key={idx}
                          className={`rounded bg-[#0a0c10] border ${hasError ? "border-red-900/60" : "border-[#2a2f38]"}`}
                        >
                          <div
                            className="flex justify-between text-[11px] p-2 cursor-pointer hover:bg-[#12141a]"
                            onClick={() => toggleLiveStep(idx)}
                          >
                            <span className={`font-medium flex items-center gap-1 ${hasError ? "text-red-400" : "text-white"}`}>
                              {r.nodeType}
                              {hasError && <span className="text-red-500">✕</span>}
                            </span>
                            <span className="flex items-center gap-1 text-[#8a909c]">
                              {r.durationMs ?? 0}ms
                              {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </span>
                          </div>
                          {isExpanded && (
                            <div className="px-2 pb-2 border-t border-[#2a2f38] text-[10px]">
                              {r.error && <div className="text-red-400 mt-1">Error: {r.error}</div>}
                              <div className="mt-1 text-[#8a909c]">Input:</div>
                              <pre className="bg-black/30 p-1 rounded overflow-auto max-h-20 whitespace-pre-wrap break-all">
                                {JSON.stringify(r.input, null, 2)}
                              </pre>
                              <div className="mt-1 text-[#8a909c]">Output:</div>
                              <pre className="bg-black/30 p-1 rounded overflow-auto max-h-20 whitespace-pre-wrap break-all">
                                {JSON.stringify(
                                  (Array.isArray(r.output) && r.output.length
                                    ? r.output.map((it: any) => (it && it.json ? it.json : it))
                                    : r.output),
                                  null,
                                  2
                                )}
                              </pre>
                            </div>
                          )}
                          {!isExpanded && r.error && (
                            <div className="px-2 pb-1.5 text-red-400 text-[10px]">Error: {r.error}</div>
                          )}
                          {!isExpanded && !r.error && r.output != null && (
                            <div className="px-2 pb-1.5">
                              <pre className="text-[9px] text-[#8a909c] overflow-hidden max-h-8">
                                {(JSON.stringify(
                                  Array.isArray(r.output) && r.output[0] && r.output[0].json ? r.output[0].json : r.output
                                )?.slice(0, 120))}...
                              </pre>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {execution.finalOutput && (
                      <div className="pt-1">
                        <div className="text-emerald-400 text-xs mb-1">FINAL OUTPUT</div>
                        <pre className="text-[10px] bg-black/40 p-2 rounded overflow-auto max-h-28">
                          {JSON.stringify(
                            (Array.isArray(execution.finalOutput)
                              ? execution.finalOutput.map((it: any) => (it && it.json ? it.json : it))
                              : execution.finalOutput),
                            null,
                            2
                          )}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {rightTab === "history" && (
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="px-3 py-2 flex items-center justify-between border-b border-[#2a2f38] bg-[#1a1d24]">
                <div className="text-xs font-medium flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5" /> EXECUTION HISTORY
                </div>
                {executions.length > 0 && (
                  <button
                    onClick={clearAllHistory}
                    className="text-[10px] flex items-center gap-1 text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="w-3 h-3" /> Clear
                  </button>
                )}
              </div>

              {/* List */}
              <div className="flex-1 overflow-auto p-2 text-xs space-y-1">
                {executions.length === 0 && (
                  <div className="text-[#8a909c] p-2 text-center">
                    No past executions yet.<br />Run a workflow to populate history.
                  </div>
                )}
                {executions.map((rec) => {
                  const dur = rec.finishedAt
                    ? Math.max(0, new Date(rec.finishedAt).getTime() - new Date(rec.startedAt).getTime())
                    : 0;
                  const isSel = selectedHistoryId === rec.id;
                  return (
                    <div
                      key={rec.id}
                      onClick={() => selectHistoryRecord(rec.id)}
                      className={`p-2 rounded border cursor-pointer transition-colors ${
                        isSel ? "bg-[#1f232b] border-[#5c8df6]" : "bg-[#0a0c10] border-[#2a2f38] hover:border-[#3a404c]"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-medium truncate max-w-[150px]">{rec.workflowName}</div>
                        <div className={`text-[10px] px-1 rounded ${rec.success ? "text-emerald-400" : "text-red-400"}`}>
                          {rec.success ? "OK" : "FAIL"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-[#8a909c] mt-0.5">
                        <Clock className="w-3 h-3" />
                        <span>{new Date(rec.startedAt).toLocaleString()}</span>
                        <span>· {dur}ms</span>
                        <button
                          onClick={(e) => removeHistoryRecord(rec.id, e)}
                          className="ml-auto text-red-500/70 hover:text-red-400"
                          title="Delete this run"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Read-only replay view + actions for selected past execution */}
              {selectedHistory && (
                <div className="border-t border-[#2a2f38] bg-[#12141a] flex flex-col max-h-[280px]">
                  <div className="px-2 py-1.5 flex items-center justify-between text-[10px] border-b border-[#2a2f38]">
                    <span className="font-medium text-[#c5c9d0]">
                      Replay • {new Date(selectedHistory.startedAt).toLocaleTimeString()}
                    </span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => loadWorkflowFromExecution(selectedHistory)}
                        className="px-1.5 py-0.5 bg-[#1f232b] hover:bg-[#2a2f38] rounded text-[10px]"
                        title="Load the workflow as it was at time of run"
                      >
                        Load WF
                      </button>
                      <button
                        onClick={() => reRunExecution(selectedHistory)}
                        className="px-1.5 py-0.5 bg-[#ff6d5a] hover:bg-[#f55c46] text-black rounded text-[10px] flex items-center gap-0.5"
                        title="Restore snapshot and re-execute now"
                      >
                        <RotateCcw className="w-3 h-3" /> Re-run
                      </button>
                      <button onClick={() => setSelectedHistoryId(null)} className="px-1 text-[#8a909c]">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto p-2 text-[10px] execution-log space-y-1 text-[#a1a6b0]">
                    <div className={`text-xs ${selectedHistory.success ? "text-emerald-400" : "text-red-400"} mb-1`}>
                      {selectedHistory.success ? "SUCCESS" : "FAILED"} {selectedHistory.error && `· ${selectedHistory.error}`}
                    </div>
                    {selectedHistory.results.map((r, idx) => {
                      const hasErr = !!r.error;
                      return (
                        <div
                          key={idx}
                          className={`rounded p-1.5 border ${hasErr ? "border-red-800/50" : "border-[#2a2f38]"} bg-[#0a0c10]`}
                        >
                          <div className="flex justify-between">
                            <span className={`font-medium ${hasErr ? "text-red-400" : "text-white"}`}>{r.nodeType}</span>
                            <span className="text-[#8a909c]">{r.durationMs ?? 0}ms</span>
                          </div>
                          {hasErr && <div className="text-red-400 text-[9px]">Error: {r.error}</div>}
                          <pre className="text-[9px] mt-0.5 max-h-14 overflow-auto whitespace-pre-wrap break-all">
                            {JSON.stringify(
                              Array.isArray(r.output) ? r.output.map((it: any) => it && it.json ? it.json : it) : r.output,
                              null,
                              1
                            )}
                          </pre>
                        </div>
                      );
                    })}
                    {selectedHistory.finalOutput && (
                      <div>
                        <span className="text-emerald-400">Final:</span>{" "}
                        <pre className="inline text-[9px]">{JSON.stringify(
                          Array.isArray(selectedHistory.finalOutput)
                            ? selectedHistory.finalOutput.map((it: any) => (it && it.json ? it.json : it))
                            : selectedHistory.finalOutput
                        )?.slice(0, 80)}...</pre>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {rightTab === "versions" && (
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="px-3 py-2 flex items-center justify-between border-b border-[#2a2f38] bg-[#1a1d24]">
                <div className="text-xs font-medium flex items-center gap-1.5">
                  <RotateCcw className="w-3.5 h-3.5" /> VERSION HISTORY
                </div>
                <div className="flex gap-1">
                  <button onClick={() => {
                    const updated = saveNewVersion();
                    if (useApi && updated) {
                      // persist the new versioned snapshot
                      apiFetch(`/api/workflows/${encodeURIComponent(workflow.id)}`, { method: "PUT", body: JSON.stringify({ ...workflow, versions: updated.versions || workflow.versions }) }).then(() => loadWorkflowsFromApi().catch(()=>{})).catch(()=>{});
                    }
                  }} className="text-[10px] px-1.5 py-0.5 bg-[#1f232b] hover:bg-[#2a2f38] rounded">Save Version</button>
                  <button onClick={togglePublish} className="text-[10px] px-1.5 py-0.5 bg-[#1f232b] hover:bg-[#2a2f38] rounded" title="Toggle Publish/Draft + snapshot if publishing">Publish/Draft</button>
                  { (workflow.versions?.length || 0) > 0 && (
                    <button onClick={() => { /* clear versions client only */ const cleared = {...workflow, versions: []}; setWorkflow(cleared); if(!useApi) localStorage.setItem(currentUser ? `n8nlike-workflow-${currentUser.id}` : "n8nlike-workflow", JSON.stringify(cleared)); toast.info("Versions cleared (kept current)"); }} className="text-[10px] px-1 py-0.5 text-red-400">Clear</button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-auto p-2 text-xs space-y-1">
                {/* Draft vs Published state indicator for #6 */}
                <div className={`mb-2 px-2 py-0.5 rounded text-[10px] flex items-center gap-1 ${((workflow as any).isPublished) ? "bg-[#5c8df6]/20 text-[#5c8df6]" : "bg-[#f59e0b]/10 text-amber-400"}`}>
                  {((workflow as any).isPublished) ? "📘 PUBLISHED (versioned snapshot)" : "✏️ DRAFT (editing)"} · { (workflow.versions || []).length } saved versions
                </div>
                {(!workflow.versions || workflow.versions.length === 0) && (
                  <div className="text-[#8a909c] p-2 text-center text-[10px]">
                    No versions yet.<br />Save (Ctrl/Cmd+S) to create history. Restore any time.
                  </div>
                )}
                {(workflow.versions || []).slice().reverse().map((ver, idx) => {
                  const vnum = ver.version;
                  return (
                    <div key={idx} className="p-2 rounded border bg-[#0a0c10] border-[#2a2f38] hover:border-[#3a404c]">
                      <div className="flex justify-between items-center">
                        <div>
                          <span className="font-medium">v{vnum}</span>
                          <span className="ml-2 text-[10px] text-[#8a909c]">{ver.name}</span>
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => restoreVersion(ver)}
                            className="px-1.5 py-0.5 bg-[#ff6d5a] hover:bg-[#f55c46] text-black rounded text-[10px] flex items-center gap-0.5"
                          >
                            <RotateCcw className="w-3 h-3" /> Restore
                          </button>
                          <button
                            onClick={() => deleteVersion(ver)}
                            className="px-1 py-0.5 text-red-400 hover:text-red-500 text-[10px]"
                            title="Delete this version snapshot"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      <div className="text-[9px] text-[#8a909c] mt-0.5">{new Date(ver.savedAt).toLocaleString()} · {ver.nodes.length} nodes</div>
                    </div>
                  );
                })}
              </div>
              <div className="p-2 border-t border-[#2a2f38] text-[9px] text-[#8a909c]">
                Versions auto-saved on Save/Publish. Max 10 kept. Use DRAFT/PUBLISHED toggle above. Restore updates canvas &amp; persists.
              </div>
            </div>
          )}

          {rightTab === "credentials" && (
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="px-3 py-2 flex items-center justify-between border-b border-[#2a2f38] bg-[#1a1d24]">
                <div className="text-xs font-medium flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5" /> CREDENTIALS
                </div>
                <button onClick={() => setShowCredManager(true)} className="text-[10px] px-1.5 py-0.5 bg-[#5c8df6] text-black rounded">Manage</button>
              </div>
              <div className="flex-1 overflow-auto p-2 text-xs space-y-1">
                {credentials.length === 0 && (
                  <div className="text-[#8a909c] p-2 text-center">No credentials. Use Manage or selector in node inspector.</div>
                )}
                {credentials.map((c) => (
                  <div key={c.id} className="p-2 rounded border bg-[#0a0c10] border-[#2a2f38] flex justify-between items-center">
                    <div>
                      <div className="font-medium truncate max-w-[160px]">{c.name}</div>
                      <div className="text-[9px] text-[#8a909c]">{c.type} {c.platform ? `· ${c.platform}` : ''}</div>
                    </div>
                    <button onClick={() => { setShowCredManager(true); /* could preselect but simple */ }} className="text-[10px] px-1 py-0.5 bg-[#1f232b] rounded">Edit</button>
                  </div>
                ))}
              </div>
              <div className="p-2 border-t border-[#2a2f38] text-[9px] text-[#8a909c]">Use in HTTP/AI/Email/Telegram/Slack nodes. Works local+API.</div>
            </div>
          )}
        </div>
      </div>

      <div className="h-7 border-t border-[#2a2f38] bg-[#16181f] flex items-center px-3 text-[10px] text-[#8a909c] gap-3">
        n8nlike • Visual node-based workflow automation • Data passes between nodes as JSON objects
        <span className="opacity-50">· Shortcuts: ⌘/Ctrl+S save, ⌘/Ctrl+Enter run, Del remove, ⌘Z undo, Esc deselect</span>
      </div>

      {/* Credentials Manager Modal (Dedicated UI for create/list/edit/delete + test + per-platform forms) */}
      {showCredManager && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={closeCredManager}>
          <div
            className="w-full max-w-[620px] mx-4 bg-[#16181f] border border-[#2a2f38] rounded-xl shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-[#2a2f38] flex items-center justify-between bg-[#1a1d24]">
              <div className="font-medium flex items-center gap-2"><Key className="w-4 h-4" /> Credentials Manager</div>
              <button onClick={closeCredManager} className="text-[#8a909c] hover:text-white">✕</button>
            </div>

            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* List */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-[#8a909c]">SAVED CREDENTIALS ({credentials.length})</div>
                  <button onClick={() => openNewCredential()} className="text-xs px-2 py-0.5 bg-[#5c8df6] text-black rounded flex items-center gap-1">
                    <Plus className="w-3 h-3" /> New
                  </button>
                </div>
                <div className="max-h-[260px] overflow-auto space-y-1 text-sm border border-[#2a2f38] rounded p-1 bg-[#0a0c10]">
                  {credentials.length === 0 && <div className="p-2 text-xs text-[#8a909c]">No credentials yet. Create one for HTTP / Email / AI auth.</div>}
                  {credentials.map((c) => (
                    <div key={c.id} className={`flex items-center justify-between p-2 rounded border ${editingCredId === c.id ? "border-[#5c8df6] bg-[#1f232b]" : "border-[#2a2f38] hover:bg-[#12141a]"}`}>
                      <div>
                        <div className="font-medium truncate max-w-[180px]">{c.name}</div>
                        <div className="text-[10px] text-[#8a909c]">{c.type}</div>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => openEditCredential(c)} className="text-[10px] px-1.5 py-0.5 bg-[#1f232b] rounded">Edit</button>
                        <button onClick={() => deleteCredentialFromStore(c.id)} className="text-[10px] px-1.5 py-0.5 text-red-400 bg-[#1f232b] rounded">Del</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-[10px] text-[#8a909c]">Credentials are stored encrypted (MVP obfuscation). Use selector in HTTP/Email/AI inspectors.</div>
              </div>

              {/* Form */}
              <div>
                <div className="text-xs font-medium mb-2 text-[#8a909c]"> {editingCredId ? "EDIT" : "NEW"} CREDENTIAL</div>
                <div className="space-y-3">
                  <div>
                    <div className="text-xs mb-1">Name</div>
                    <input className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-sm" value={credForm.name} onChange={(e) => setCredForm({ ...credForm, name: e.target.value })} />
                  </div>
                  <div>
                    <div className="text-xs mb-1">Type</div>
                    <select
                      className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-sm"
                      value={credForm.type}
                      onChange={(e) => {
                        const newType = e.target.value as CredentialType;
                        const def = getCredentialTypeDef(newType)!;
                        const empty: Record<string, any> = {};
                        def.fields.forEach((f) => (empty[f.key] = credForm.data[f.key] || ""));
                        setCredForm({ ...credForm, type: newType, data: empty });
                      }}
                    >
                      {CREDENTIAL_TYPES.map((d) => (
                        <option key={d.type} value={d.type}>{d.label} — {d.description}</option>
                      ))}
                    </select>
                  </div>

                  {/* Dynamic per-type form fields */}
                  {getCredentialTypeDef(credForm.type)?.fields.map((field) => (
                    <div key={field.key}>
                      <div className="text-xs mb-1">{field.label}</div>
                      {field.type === "password" ? (
                        <input
                          type="password"
                          className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-sm font-mono"
                          placeholder={field.placeholder}
                          value={credForm.data[field.key] ?? ""}
                          onChange={(e) => updateCredFormField(field.key, e.target.value)}
                        />
                      ) : field.type === "textarea" ? (
                        <textarea
                          className="w-full h-20 bg-[#0a0c10] border border-[#2a2f38] rounded p-2 text-xs font-mono"
                          placeholder={field.placeholder}
                          value={typeof credForm.data[field.key] === "string" ? credForm.data[field.key] : JSON.stringify(credForm.data[field.key] || {}, null, 2)}
                          onChange={(e) => {
                            try { updateCredFormField(field.key, JSON.parse(e.target.value)); } catch { updateCredFormField(field.key, e.target.value); }
                          }}
                        />
                      ) : field.type === "select" ? (
                        <select className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1" value={credForm.data[field.key] || ""} onChange={(e) => updateCredFormField(field.key, e.target.value)}>
                          <option value="">{field.placeholder || "Select..."}</option>
                          {((field as any).options || []).map((o: string) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-sm" placeholder={field.placeholder} value={credForm.data[field.key] ?? ""} onChange={(e) => updateCredFormField(field.key, e.target.value)} />
                      )}
                    </div>
                  ))}

                  <div className="flex gap-2 pt-2">
                    <button onClick={saveCurrentCredential} disabled={isApiOperation} className="flex-1 px-3 py-1 bg-[#5c8df6] text-black rounded text-sm font-medium">
                      {editingCredId ? "Update" : "Create"} Credential
                    </button>
                    {editingCredId && (
                      <button onClick={deleteCurrentEditingCred} className="px-3 py-1 bg-red-900/40 text-red-300 rounded text-sm">Delete</button>
                    )}
                    <button onClick={testCurrentCredential} className="px-3 py-1 bg-[#1f232b] border border-[#2a2f38] rounded text-sm">Test</button>
                  </div>

                  {credTestResult && (
                    <div className="text-[11px] p-2 bg-black/40 border border-[#2a2f38] rounded whitespace-pre-wrap font-mono text-emerald-300">
                      {credTestResult}
                    </div>
                  )}
                  <div className="text-[10px] text-[#8a909c]">Expressions supported at runtime inside credential values (e.g. {'{{ $json.token }}'}).</div>
                </div>
              </div>
            </div>

            <div className="px-4 py-2 border-t border-[#2a2f38] bg-[#1a1d24] text-[10px] text-[#8a909c] flex justify-between">
              <span>MVP: data encrypted at rest (simple XOR). Works in LOCAL + API mode.</span>
              <button onClick={closeCredManager} className="underline">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Templates Modal (Future.md #6) - curated sample workflows as importable JSON */}
      {showTemplatesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setShowTemplatesModal(false)}>
          <div
            className="w-full max-w-[520px] mx-4 bg-[#16181f] border border-[#2a2f38] rounded-xl shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-[#2a2f38] flex items-center justify-between bg-[#1a1d24]">
              <div className="font-medium flex items-center gap-2"><BookOpen className="w-4 h-4" /> Templates Gallery</div>
              <button onClick={() => setShowTemplatesModal(false)} className="text-[#8a909c] hover:text-white">✕</button>
            </div>
            <div className="p-4 space-y-3 max-h-[420px] overflow-auto">
              <div className="text-xs text-[#8a909c]">Click Import to load curated sample workflow JSON into the canvas (replaces current).</div>
              {TEMPLATES.map((tpl, idx) => (
                <div key={idx} className="p-3 rounded border border-[#2a2f38] bg-[#0a0c10] flex flex-col gap-1">
                  <div className="font-medium text-sm">{tpl.name}</div>
                  <div className="text-[11px] text-[#8a909c]">{tpl.description}</div>
                  <div className="flex gap-2 mt-1">
                    <button
                      onClick={() => {
                        loadTemplate(tpl);
                        setShowTemplatesModal(false);
                      }}
                      className="text-xs px-3 py-1 bg-[#5c8df6] hover:bg-[#4a7ad9] text-black rounded"
                    >
                      Import
                    </button>
                    <div className="text-[10px] text-[#6b7280] self-center">Nodes: {(tpl.data?.nodes as any)?.length || 0} · Edges: {(tpl.data?.edges as any)?.length || 0}</div>
                  </div>
                </div>
              ))}
              <div className="pt-2 text-[10px] text-[#8a909c] border-t border-[#2a2f38]">Templates are static JSON examples. Use Export/Import for your own. Also see palette Templates section + Versions tab.</div>
            </div>
            <div className="px-4 py-2 border-t border-[#2a2f38] bg-[#1a1d24] text-[10px] flex justify-end">
              <button onClick={() => setShowTemplatesModal(false)} className="text-xs underline">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const N8nlikeNoSSR = dynamic(
  () => Promise.resolve(() => (
    <ReactFlowProvider>
      <N8nlike />
    </ReactFlowProvider>
  )),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center bg-[#0f1115] text-[#8a909c]">
        Loading n8nlike editor…
      </div>
    ),
  }
);

export default N8nlikeNoSSR;
