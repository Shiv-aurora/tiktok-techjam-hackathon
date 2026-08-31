export type AgentStatus = "ready" | "busy" | "stopped" | "error";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type MessageRole = "user" | "assistant";

export type TransactionStatus =
  | "created"
  | "preparing"
  | "executing"
  | "verifying"
  | "committing"
  | "committed"
  | "aborting"
  | "aborted";
export type TransactionDecision = "commit" | "abort" | null;
export type TransactionCleanupStatus = "pending" | "completed" | "failed";
export type TransactionRealStateOutcome = "unchanged" | "committed" | "unknown" | null;
export type FilesystemEffectOperation = "create" | "modify" | "delete";
export type FilesystemObjectType = "file" | "directory" | "symlink" | "special";

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
  role: MessageRole;
  content: string;
  createdAt: string;
}

export interface RunUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
}

export interface FilesystemEffect {
  id: string;
  transactionId: string;
  category: "filesystem";
  operation: FilesystemEffectOperation;
  path: string;
  objectType: FilesystemObjectType;
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

export interface TransactionViolation {
  code: string;
  message: string;
  path: string | null;
}

export interface TransactionIntegrity {
  baselineHash: string | null;
  shadowHash: string | null;
  realHashBeforeDecision: string | null;
  finalRealHash: string | null;
}

export interface AgentTransaction {
  id: string;
  agentId: string;
  runId: string;
  status: TransactionStatus;
  decision: TransactionDecision;
  decisionReason: string | null;
  violations: TransactionViolation[];
  effects: FilesystemEffect[];
  isolation: "shadow-workspace";
  realStateOutcome: TransactionRealStateOutcome;
  integrity: TransactionIntegrity;
  cleanupStatus: TransactionCleanupStatus;
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
  usage: RunUsage | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface Database {
  version: 2;
  agents: Agent[];
  messages: Message[];
  runs: AgentRun[];
  transactions: AgentTransaction[];
}

export interface CreateAgentInput {
  name: string;
  description?: string | undefined;
  instructions?: string | undefined;
}

export interface UpdateAgentInput {
  name?: string | undefined;
  description?: string | undefined;
  instructions?: string | undefined;
}

export interface RunnerResult {
  output: string;
  threadId: string | null;
  usage: RunUsage | null;
}

export interface RunnerRequest {
  agentId: string;
  transactionId: string | null;
  workspacePath: string;
  prompt: string;
  threadId: string | null;
}

export interface AgentRunner {
  run(request: RunnerRequest): Promise<RunnerResult>;
  cancel(agentId: string): Promise<boolean>;
  isAvailable(): Promise<boolean>;
}
