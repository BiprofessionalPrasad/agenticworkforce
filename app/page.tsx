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
  Handle,
  Position,
  ReactFlowProvider,
  useOnSelectionChange,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Play, Save, Trash2, Plus, Download, Upload, RefreshCw, History, Clock, RotateCcw, X, ChevronDown, ChevronUp, Server, HardDrive, Webhook, Timer, Bot, Database, Mail, Repeat, Merge, Pencil, Code, Info, Loader, CircleCheck, CircleX, Search, Maximize2, LayoutDashboard, Circle, Undo2, Redo2, Globe, GitBranch } from "lucide-react";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import dynamic from "next/dynamic";

import { Workflow, WorkflowNode, WorkflowEdge, ExecutionResult, NodeType, ExecutionRecord } from "../lib/types";
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

const defaultWorkflow: Workflow = {
  id: "wf-1",
  name: "My Workflow",
  nodes: [],
  edges: [],
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
  const [rightTab, setRightTab] = useState<"inspector" | "logs" | "history">("inspector");

  // Collapsible state for live execution log steps
  const [expandedLiveSteps, setExpandedLiveSteps] = useState<Set<number>>(new Set());

  // API mode: when true, use backend API + persistent storage; fallback to localStorage when false or on error
  const [useApi, setUseApi] = useState<boolean>(true);
  const [workflowsList, setWorkflowsList] = useState<Workflow[]>([]);
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(false);
  const [isApiOperation, setIsApiOperation] = useState(false);

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

  const loadWorkflowsFromApi = async () => {
    setIsLoadingWorkflows(true);
    try {
      const data = await apiFetch("/api/workflows");
      const list: Workflow[] = data?.workflows || [];
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
      const wf = await apiFetch(`/api/workflows/${encodeURIComponent(id)}`);
      if (wf) {
        setWorkflow(wf);
        setNodes(wf.nodes || []);
        setEdges(wf.edges || []);
        setSelectedNodeId(null);
        setExecution(null);
        setSelectedHistoryId(null);
        toast.success(`Loaded workflow from API: ${wf.name}`);
      }
    } catch (e: any) {
      toast.error("Failed to load from API: " + e.message);
    } finally {
      setIsApiOperation(false);
    }
  };

  const saveWorkflowToApi = async () => {
    const current = { ...workflow, nodes: nodes as WorkflowNode[], edges: edges as WorkflowEdge[] };
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
      localStorage.setItem("n8nlike-workflow", JSON.stringify(current));
      return current;
    } finally {
      setIsApiOperation(false);
    }
  };

  const createNewWorkflowViaApi = async () => {
    setIsApiOperation(true);
    try {
      const created = await apiFetch("/api/workflows", {
        method: "POST",
        body: JSON.stringify({ name: "New Workflow", nodes: [], edges: [] }),
      });
      setWorkflow(created);
      setNodes([]);
      setEdges([]);
      setSelectedNodeId(null);
      setExecution(null);
      setSelectedHistoryId(null);
      await loadWorkflowsFromApi();
      toast.success("Created new workflow via API");
    } catch (e: any) {
      toast.error("Create via API failed: " + e.message);
      const empty: Workflow = { id: `wf-${Date.now()}`, name: "New Workflow", nodes: [], edges: [] };
      setWorkflow(empty);
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
        className={`w-[220px] overflow-hidden rounded-lg border text-sm shadow transition-all ${selected ? "border-[#ff6d5a] ring-1 ring-[#ff6d5a]/30" : "border-[#2a2f38]"} ${statusClass} bg-[#16181f]`}
      >
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

  // Load preference + workflows or local on mount
  useEffect(() => {
    const savedMode = localStorage.getItem("n8nlike-use-api");
    const initialApi = savedMode === null ? true : savedMode === "true";
    setUseApi(initialApi);

    const loadInitial = async () => {
      // Load client history always
      const hist = listExecutions();
      setExecutions(hist);

      if (initialApi) {
        const list = await loadWorkflowsFromApi();  // may flip useApi on fail
        if (list.length > 0) {
          // auto load most recent
          const mostRecent = list[0];
          setWorkflow(mostRecent);
          setNodes(mostRecent.nodes || []);
          setEdges(mostRecent.edges || []);
          toast.success("Loaded latest workflow from API");
        } else {
          // create default on server
          await createNewWorkflowViaApi();
        }
      } else {
        // original local load
        const saved = localStorage.getItem("n8nlike-workflow");
        if (saved) {
          try {
            const parsed: Workflow = JSON.parse(saved);
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
  }, [setNodes, setEdges]);

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
          const saved = localStorage.getItem("n8nlike-workflow");
          if (saved) {
            try {
              const p = JSON.parse(saved);
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

  // Persist to localStorage ONLY when in local mode
  useEffect(() => {
    if (!useApi && (workflow.nodes.length > 0 || workflow.edges.length > 0)) {
      localStorage.setItem("n8nlike-workflow", JSON.stringify(workflow));
    }
  }, [workflow, useApi]);

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

  const addNode = (type: NodeType, position?: { x: number; y: number }) => {
    const def = getNodeDefinition(type);
    const newNode: WorkflowNode = {
      id: `${type}-${uuidv4().slice(0, 8)}`,
      type,
      position: position || { x: 200 + Math.random() * 200, y: 120 + Math.random() * 200 },
      data: {
        label: def.label,
        parameters: JSON.parse(JSON.stringify(def.defaultParameters)),
      },
    };

    pushToHistory(nodes, edges);
    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newNode.id);
    toast.success(`Added ${def.label}`);
  };

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
      const result = await executeWorkflow(currentWorkflow);
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

      // Persist to history
      try {
        const savedRecord = saveExecution(result, currentWorkflow);
        setExecutions((prev) => [savedRecord, ...prev].slice(0, 50));
      } catch {}

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
        const savedRecord = saveExecution(failResult, currentWorkflow);
        setExecutions((prev) => [savedRecord, ...prev].slice(0, 50));
      } catch {}
      toast.error("Unexpected error: " + err.message);
    } finally {
      setIsRunning(false);
    }
  }, [workflow, nodes, edges, rightTab, useApi]);

  // History actions
  const reRunExecution = (record: ExecutionRecord) => {
    // Load snapshot into canvas, then run
    const snap = record.workflowSnapshot;
    const restoredWorkflow: Workflow = {
      id: `wf-${Date.now()}`,
      name: `${snap.name} (from history)`,
      nodes: JSON.parse(JSON.stringify(snap.nodes)),
      edges: JSON.parse(JSON.stringify(snap.edges)),
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
    const snap = record.workflowSnapshot;
    const restored: Workflow = {
      id: `wf-${Date.now()}`,
      name: snap.name,
      nodes: JSON.parse(JSON.stringify(snap.nodes)),
      edges: JSON.parse(JSON.stringify(snap.edges)),
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
    clearExecutions();
    setExecutions([]);
    setSelectedHistoryId(null);
    toast.info("Execution history cleared");
  };

  const removeHistoryRecord = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    deleteExecution(id);
    setExecutions((prev) => prev.filter((r) => r.id !== id));
    if (selectedHistoryId === id) setSelectedHistoryId(null);
    toast.info("Execution removed from history");
  };

  const selectHistoryRecord = (id: string) => {
    setSelectedHistoryId(id);
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

  const clearWorkflow = () => {
    const empty: Workflow = {
      id: `wf-${Date.now()}`,
      name: "New Workflow",
      nodes: [],
      edges: [],
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
      localStorage.removeItem("n8nlike-workflow");
    }
    toast.info("Workflow cleared");
  };

  const saveWorkflow = useCallback(() => {
    const wf = { ...workflow, nodes, edges, updatedAt: new Date().toISOString() };
    if (useApi) {
      saveWorkflowToApi();
    } else {
      localStorage.setItem("n8nlike-workflow", JSON.stringify(wf));
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
          setWorkflow(imported);
          setNodes(imported.nodes || []);
          setEdges(imported.edges || []);
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

  // Keyboard shortcuts (Task 5 polish)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const isCtrlOrCmd = isMac ? e.metaKey : e.ctrlKey;

      if (e.key === "Delete" || e.key === "Backspace") {
        // only if not editing input/textarea
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        e.preventDefault();
        deleteSelected();
      } else if (isCtrlOrCmd && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveWorkflow();
      } else if (isCtrlOrCmd && (e.key === "Enter" || e.key.toLowerCase() === "r")) {
        e.preventDefault();
        runWorkflow();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setSelectedNodeId(null);
        setSelectedNodeIds([]);
        setSelectedEdgeIds([]);
      } else if (isCtrlOrCmd && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((isCtrlOrCmd && e.key.toLowerCase() === "y") || (isCtrlOrCmd && e.shiftKey && e.key.toLowerCase() === "z")) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteSelected, saveWorkflow, runWorkflow, undo, redo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Simple parameter editor based on node type
  const renderParamEditor = () => {
    if (!selectedNode) {
      return <div className="p-4 text-[#8a909c] text-sm">Select a node to edit its properties.</div>;
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
          <div className="text-[10px] text-[#8a909c]">Simulated: config used on Execute. No real timer in MVP.</div>
        </div>
      );
    }

    if (type === "aiLlm") {
      return (
        <div className="p-4 space-y-3 text-sm">
          <div>
            <div className="text-xs mb-1">Prompt</div>
            <textarea className="w-full h-16 bg-[#0a0c10] border border-[#2a2f38] rounded p-2 text-xs" value={params.prompt || ""} onChange={(e) => updateSelectedNodeParams({ prompt: e.target.value })} />
          </div>
          <div>
            <div className="text-xs mb-1">Model</div>
            <input className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs" value={params.model || ""} onChange={(e) => updateSelectedNodeParams({ model: e.target.value })} />
          </div>
          <div className="text-[10px] text-[#8a909c]">Mock LLM — returns structured response + summary.</div>
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
            <div className="text-xs mb-1">Subject</div>
            <input className="w-full bg-[#0a0c10] border border-[#2a2f38] rounded px-2 py-1 text-xs" value={params.subject || ""} onChange={(e) => updateSelectedNodeParams({ subject: e.target.value })} />
          </div>
          <div>
            <div className="text-xs mb-1">Body (supports {'{{ $json }}'})</div>
            <textarea className="w-full h-16 bg-[#0a0c10] border border-[#2a2f38] rounded p-2 text-xs font-mono" value={params.body || ""} onChange={(e) => updateSelectedNodeParams({ body: e.target.value })} />
          </div>
          <div className="text-[10px] text-[#8a909c]">Mock send — result logged in execution + console.</div>
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

  const currentWorkflowForExport = { ...workflow, nodes, edges };

  if (!isClient) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0f1115] text-[#8a909c]">
        Loading n8nlike editor…
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

          {/* API / Local mode toggle + Workflow switcher */}
          <button
            onClick={() => setUseApi(!useApi)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] border transition-colors ${useApi ? "bg-[#1f232b] border-[#5c8df6] text-[#5c8df6]" : "bg-[#1f232b] border-[#2a2f38] text-[#8a909c] hover:border-[#ff6d5a]"}`}
            title={useApi ? "API mode (persisted on server)" : "Local mode (browser only)"}
          >
            {useApi ? <Server className="w-3 h-3" /> : <HardDrive className="w-3 h-3" />}
            {useApi ? "API" : "LOCAL"}
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
                    {w.name} {w.id === workflow.id ? "•" : ""}
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
          <button onClick={() => runWorkflow()} disabled={isRunning} className="flex items-center gap-1.5 rounded bg-[#ff6d5a] hover:bg-[#f55c46] px-4 py-1.5 text-xs font-medium text-black disabled:opacity-60" title="Ctrl/Cmd + Enter or R">
            {isRunning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} 
            {isRunning ? "Running..." : "Execute Workflow"}
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
                  { id: "ai", type: "aiLlm", position: { x: 260, y: 160 }, data: { label: "AI Summarize", parameters: { prompt: "Summarize the provided data concisely and output sentiment.", model: "mock-gpt" } } },
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
            IF node uses true/false ports. New nodes: Webhook/Schedule/AI/DB/Email/Loop/Merge.
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
            nodeTypes={nodeTypes}
            onInit={setRfInstance}
            fitView
            proOptions={{ hideAttribution: true }}
            className={`bg-[#0f1115] ${isRunning ? "executing" : ""}`}
          >
            <Background color="#232831" gap={18} />
            <Controls />
            <MiniMap nodeStrokeWidth={2} nodeColor="#3b414d" maskColor="#0f111580" />

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
                  pushToHistory(nodes, edges);
                  setNodes((nds) => {
                    const spacing = 260;
                    return nds.map((n, i) => ({
                      ...n,
                      position: { x: 80 + (i % 4) * spacing, y: 100 + Math.floor(i / 4) * 140 },
                    }));
                  });
                  toast.info("Auto layout applied");
                }}
                className="px-2 py-1 text-[10px] bg-[#1f232b] hover:bg-[#2a2f38] border border-[#2a2f38] rounded flex items-center gap-1"
                title="Simple auto layout"
              >
                <LayoutDashboard className="w-3 h-3" /> Layout
              </button>
            </Panel>
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
        </div>
      </div>

      <div className="h-7 border-t border-[#2a2f38] bg-[#16181f] flex items-center px-3 text-[10px] text-[#8a909c] gap-3">
        n8nlike • Visual node-based workflow automation • Data passes between nodes as JSON objects
        <span className="opacity-50">· Shortcuts: ⌘/Ctrl+S save, ⌘/Ctrl+Enter run, Del remove, ⌘Z undo, Esc deselect</span>
      </div>
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
