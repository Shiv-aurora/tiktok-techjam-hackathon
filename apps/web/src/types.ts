export type AgentStatus = "ready" | "busy" | "stopped" | "error";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type TransactionStatus =
  | "created"
  | "preparing"
  | "executing"
  | "verifying"
  | "committing"
  | "committed"
  | "aborting"
  | "aborted";

export interface Agent {
  id: string;
  name: string;
  description: string;
  instructions: string;
  status: AgentStatus;
  workspacePath: string;
  codexThreadId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  agentId: string;
  runId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface FilesystemEffect {
  id: string;
  transactionId: string;
  category: "filesystem";
  operation: "create" | "modify" | "delete";
  path: string;
  objectType: "file" | "directory" | "symlink" | "special";
  beforeHash: string | null;
  afterHash: string | null;
  beforeMode: number | null;
  afterMode: number | null;
  beforeLinkCount: number | null;
  afterLinkCount: number | null;
  beforeLinkTarget: string | null;
  afterLinkTarget: string | null;
  symlinkAbsolute: boolean;
  symlinkEscapesWorkspace: boolean;
  protected: boolean;
  recordedAt: string;
}

export interface RuntimeEffect {
  id: string;
  transactionId: string;
  kind:
    | "process.started"
    | "process.spawned"
    | "process.exited"
    | "sensitive-resource.read"
    | "network.attempt";
  processId: number;
  parentProcessId: number;
  parentEffectId: string | null;
  recordedAt: string;
  [key: string]: unknown;
}

export interface CausalEffectGraph {
  nodes: Array<{
    id: string;
    kind: string;
    label: string;
    parentEffectId: string | null;
    risk: "normal" | "sensitive" | "dangerous" | "blocked";
  }>;
  attackPath: string[];
}

export interface AgentTransaction {
  id: string;
  agentId: string;
  runId: string;
  status: TransactionStatus;
  decision: "commit" | "abort" | null;
  decisionReason: string | null;
  violations: Array<{ code: string; message: string; path: string | null }>;
  effects: FilesystemEffect[];
  runtimeEffects: RuntimeEffect[];
  runtimeSummary: {
    processesStarted: number;
    processesSpawned: number;
    sensitiveReads: number;
    networkAttempts: number;
    blockedNetworkAttempts: number;
    unauthorizedNetworkAttempts: number;
  };
  causalGraph: CausalEffectGraph | null;
  isolation: "shadow-workspace";
  realStateOutcome: "unchanged" | "committed" | "unknown" | null;
  integrity: {
    baselineHash: string | null;
    shadowHash: string | null;
    realHashBeforeDecision: string | null;
    finalRealHash: string | null;
  };
  cleanupStatus: "pending" | "completed" | "failed";
  cleanupError: string | null;
  startedAt: string | null;
  verifiedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  agentId: string;
  transactionId: string | null;
  status: RunStatus;
  prompt: string;
  output: string | null;
  error: string | null;
  usage: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
  } | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface SystemInfo {
  arkConfigured: boolean;
  arkBaseUrl: string;
  arkModel: string | null;
  codexAvailable: boolean;
  codexSandboxMode: string;
  runtimeProvider: "local-process" | "container";
  containerEngine: string | null;
  runtime: string;
  zeroCommit: {
    enabled: boolean;
    isolation: string;
    commitAuthority: string;
    protectedPaths: string[];
    protectedResources: string[];
    currentEffectCoverage: string[];
    externalEffects: string;
  };
}
