import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import { isArkConfigured } from "./config.js";
import {
  HttpError,
  RunCancelledError,
  TransactionAbortedError,
} from "./errors.js";
import { JsonStore } from "./store.js";
import {
  buildCausalEffectGraph,
  emptyRuntimeEffectSummary,
  summarizeRuntimeEffects,
} from "./runtime-effects.js";
import {
  prepareRuntimeObservation,
  readRuntimeEffectLedger,
  type RuntimeObservationSession,
} from "./runtime-observer.js";
import { verifyObservedTransaction } from "./runtime-verifier.js";
import type {
  Agent,
  AgentRun,
  AgentRunner,
  AgentTransaction,
  CreateAgentInput,
  Database,
  Message,
  RunnerResult,
  TransactionViolation,
  UpdateAgentInput,
} from "./types.js";
import {
  WorkspaceIsolationError,
  WorkspaceManager,
  type PreparedTransactionWorkspace,
} from "./workspace.js";

const now = () => new Date().toISOString();
const ZERO_COMMIT_CLEANUP_ERROR_PREFIX = "ZeroCommit cleanup failed:";
const ZERO_COMMIT_RECOVERY_ERROR_PREFIX = "ZeroCommit recovery failed:";

const requiredAgent = (database: Database, agentId: string): Agent => {
  const agent = database.agents.find((item) => item.id === agentId);
  if (!agent) throw new Error("Agent disappeared during execution: " + agentId);
  return agent;
};

const requiredRun = (database: Database, runId: string): AgentRun => {
  const run = database.runs.find((item) => item.id === runId);
  if (!run) throw new Error("Run disappeared during execution: " + runId);
  return run;
};

const requiredTransaction = (
  database: Database,
  transactionId: string,
): AgentTransaction => {
  const transaction = database.transactions.find((item) => item.id === transactionId);
  if (!transaction) {
    throw new Error("Transaction disappeared during execution: " + transactionId);
  }
  return transaction;
};

const hasUnresolvedCleanup = (database: Database, agentId: string): boolean =>
  database.transactions.some(
    (transaction) =>
      transaction.agentId === agentId &&
      (transaction.status === "committed" || transaction.status === "aborted") &&
      transaction.cleanupStatus !== "completed",
  );

export class AgentService {
  private readonly activeExecutions = new Map<string, Promise<void>>();
  private readonly cancellationRequests = new Set<string>();

  constructor(
    private readonly config: AppConfig,
    private readonly store: JsonStore,
    private readonly workspaces: WorkspaceManager,
    private readonly runner: AgentRunner,
  ) {}

  async initialize(): Promise<void> {
    await this.store.initialize();
    await this.workspaces.initialize();
    const persistedTransactions = this.store.snapshot().transactions;
    const recoveries = await this.workspaces.recoverTransactions(persistedTransactions);
    const recoveryById = new Map(
      recoveries.map((recovery) => [recovery.transactionId, recovery]),
    );
    const transactionAgentById = new Map(
      persistedTransactions.map((transaction) => [transaction.id, transaction.agentId]),
    );
    const failedRecoveryByAgent = new Map<string, string>();
    for (const recovery of recoveries) {
      if (recovery.action !== "failed") continue;
      const agentId = transactionAgentById.get(recovery.transactionId);
      if (agentId) {
        failedRecoveryByAgent.set(
          agentId,
          recovery.error ?? "transaction recovery did not complete",
        );
      }
    }

    await this.store.mutate((database) => {
      const timestamp = now();
      for (const transaction of database.transactions) {
        const recovery = recoveryById.get(transaction.id);
        if (recovery) {
          transaction.cleanupStatus = recovery.action === "failed" ? "failed" : "completed";
          transaction.cleanupError = recovery.error;
          if (recovery.finalRealHash) {
            transaction.integrity.finalRealHash = recovery.finalRealHash;
            if (
              recovery.action === "validated-abort" &&
              !transaction.integrity.baselineHash
            ) {
              transaction.integrity.baselineHash = recovery.finalRealHash;
            }
          }
          if (
            recovery.action === "finalized-commit" ||
            recovery.action === "validated-commit"
          ) {
            transaction.realStateOutcome = "committed";
          } else if (
            recovery.action === "rolled-back" ||
            recovery.action === "validated-abort"
          ) {
            transaction.realStateOutcome =
              recovery.finalRealHash &&
              transaction.integrity.baselineHash === recovery.finalRealHash
                ? "unchanged"
                : "unknown";
          } else if (recovery.action === "failed") {
            transaction.realStateOutcome = "unknown";
          }
        } else if (
          (transaction.status === "committed" || transaction.status === "aborted") &&
          transaction.cleanupStatus === "pending"
        ) {
          transaction.cleanupStatus = "completed";
          transaction.cleanupError = null;
        }

        if (transaction.status !== "committed" && transaction.status !== "aborted") {
          transaction.status = "aborted";
          transaction.decision = "abort";
          transaction.decisionReason = "Server restarted before the transaction completed.";
          transaction.completedAt = timestamp;
          const finalHash = recovery?.finalRealHash ?? null;
          const baselineHash = transaction.integrity.baselineHash;
          transaction.realStateOutcome =
            finalHash && baselineHash && finalHash === baselineHash ? "unchanged" : "unknown";
          if (!recovery) {
            transaction.cleanupStatus = "completed";
            transaction.cleanupError = null;
          }
        }
      }

      for (const run of database.runs) {
        if (run.status === "queued" || run.status === "running") {
          run.status = "cancelled";
          run.error = "Server restarted while this run was active";
          run.completedAt = timestamp;
        }
      }
      for (const agent of database.agents) {
        const recoveryError = failedRecoveryByAgent.get(agent.id);
        if (recoveryError) {
          agent.status = "error";
          agent.codexThreadId = null;
          agent.lastError =
            ZERO_COMMIT_RECOVERY_ERROR_PREFIX + " " + recoveryError;
          agent.updatedAt = timestamp;
          continue;
        }
        if (agent.status === "busy") {
          agent.status = "ready";
          agent.codexThreadId = null;
          agent.updatedAt = timestamp;
        } else if (
          agent.status === "error" &&
          agent.lastError &&
          (agent.lastError.startsWith(ZERO_COMMIT_CLEANUP_ERROR_PREFIX) ||
            agent.lastError.startsWith(ZERO_COMMIT_RECOVERY_ERROR_PREFIX)) &&
          !hasUnresolvedCleanup(database, agent.id)
        ) {
          agent.status = "ready";
          agent.lastError = null;
          agent.updatedAt = timestamp;
        }
      }
    });
  }

  listAgents(): Agent[] {
    return this.store
      .snapshot()
      .agents.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  getAgent(id: string): Agent {
    const agent = this.store.snapshot().agents.find((item) => item.id === id);
    if (!agent) {
      throw new HttpError(404, "Agent not found");
    }
    return agent;
  }

  async createAgent(input: CreateAgentInput): Promise<Agent> {
    const timestamp = now();
    const id = randomUUID();
    const agent: Agent = {
      id,
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      instructions: input.instructions?.trim() ?? "",
      status: "ready",
      workspacePath: this.workspaces.workspacePath(id),
      codexThreadId: null,
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.workspaces.create(agent);
    await this.store.mutate((database) => database.agents.push(agent));
    return agent;
  }

  async updateAgent(id: string, input: UpdateAgentInput): Promise<Agent> {
    const current = this.getAgent(id);
    if (
      current.status === "busy" ||
      this.activeExecutions.has(id) ||
      hasUnresolvedCleanup(this.store.snapshot(), id)
    ) {
      throw new HttpError(409, "Finish or recover the active transaction before editing this Agent");
    }
    const updated = await this.store.mutate((database) => {
      const agent = database.agents.find((item) => item.id === id);
      if (!agent) {
        throw new HttpError(404, "Agent not found");
      }
      if (
        agent.status === "busy" ||
        this.activeExecutions.has(id) ||
        hasUnresolvedCleanup(database, id)
      ) {
        throw new HttpError(
          409,
          "Finish or recover the active transaction before editing this Agent",
        );
      }
      if (input.name !== undefined) agent.name = input.name.trim();
      if (input.description !== undefined) agent.description = input.description.trim();
      if (input.instructions !== undefined) agent.instructions = input.instructions.trim();
      agent.lastError = null;
      agent.updatedAt = now();
      return structuredClone(agent);
    });
    await this.workspaces.writeInstructions(updated);
    return updated;
  }

  async deleteAgent(id: string): Promise<{ archivedWorkspace: string }> {
    const agent = this.getAgent(id);
    await this.cancelExecution(id);
    const archivedWorkspace = await this.workspaces.archive(agent);
    await this.store.mutate((database) => {
      database.agents = database.agents.filter((item) => item.id !== id);
      database.messages = database.messages.filter((item) => item.agentId !== id);
      database.runs = database.runs.filter((item) => item.agentId !== id);
      database.transactions = database.transactions.filter((item) => item.agentId !== id);
    });
    return { archivedWorkspace };
  }

  async startAgent(id: string): Promise<Agent> {
    return this.setStatus(id, "ready");
  }

  async stopAgent(id: string): Promise<Agent> {
    this.getAgent(id);
    await this.cancelExecution(id);
    return this.setStatus(id, "stopped");
  }

  getMessages(agentId: string): Message[] {
    this.getAgent(agentId);
    return this.store
      .snapshot()
      .messages.filter((message) => message.agentId === agentId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  getRun(runId: string): AgentRun {
    const run = this.store.snapshot().runs.find((item) => item.id === runId);
    if (!run) {
      throw new HttpError(404, "Run not found");
    }
    return run;
  }

  getRuns(agentId: string): AgentRun[] {
    this.getAgent(agentId);
    return this.store
      .snapshot()
      .runs.filter((run) => run.agentId === agentId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  getTransaction(transactionId: string): AgentTransaction {
    const transaction = this.store
      .snapshot()
      .transactions.find((item) => item.id === transactionId);
    if (!transaction) {
      throw new HttpError(404, "Transaction not found");
    }
    return transaction;
  }

  getTransactions(agentId: string): AgentTransaction[] {
    this.getAgent(agentId);
    return this.store
      .snapshot()
      .transactions.filter((transaction) => transaction.agentId === agentId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async sendMessage(
    agentId: string,
    prompt: string,
  ): Promise<{ run: AgentRun; message: Message }> {
    if (!isArkConfigured(this.config)) {
      throw new HttpError(
        503,
        "Ark is not configured. Set ARK_API_KEY and ARK_MODEL, then restart.",
      );
    }
    if (this.activeExecutions.has(agentId)) {
      throw new HttpError(409, "This Agent still has an active transaction");
    }
    const timestamp = now();
    const runId = randomUUID();
    const transactionId = randomUUID();
    const run: AgentRun = {
      id: runId,
      agentId,
      transactionId,
      status: "queued",
      prompt,
      output: null,
      error: null,
      usage: null,
      startedAt: null,
      completedAt: null,
      createdAt: timestamp,
    };
    const transaction: AgentTransaction = {
      id: transactionId,
      agentId,
      runId,
      status: "created",
      decision: null,
      decisionReason: null,
      violations: [],
      effects: [],
      runtimeEffects: [],
      runtimeSummary: emptyRuntimeEffectSummary(),
      causalGraph: null,
      isolation: "shadow-workspace",
      realStateOutcome: null,
      integrity: {
        baselineHash: null,
        shadowHash: null,
        realHashBeforeDecision: null,
        finalRealHash: null,
      },
      cleanupStatus: "pending",
      cleanupError: null,
      startedAt: null,
      verifiedAt: null,
      completedAt: null,
      createdAt: timestamp,
    };
    const message: Message = {
      id: randomUUID(),
      agentId,
      runId,
      role: "user",
      content: prompt,
      createdAt: timestamp,
    };
    const agentAtStart = await this.store.mutate((database) => {
      const storedAgent = database.agents.find((item) => item.id === agentId);
      if (!storedAgent) {
        throw new HttpError(404, "Agent not found");
      }
      if (
        this.activeExecutions.has(agentId) ||
        hasUnresolvedCleanup(database, agentId)
      ) {
        throw new HttpError(409, "This Agent has an unresolved transaction");
      }
      if (storedAgent.status === "stopped") {
        throw new HttpError(409, "Start the Agent before sending a message");
      }
      if (storedAgent.status === "busy") {
        throw new HttpError(409, "This Agent is already running");
      }
      database.runs.push(run);
      database.transactions.push(transaction);
      database.messages.push(message);
      const snapshot = structuredClone(storedAgent);
      storedAgent.status = "busy";
      storedAgent.lastError = null;
      storedAgent.updatedAt = timestamp;
      return snapshot;
    });
    const execution = this.executeRun(agentAtStart, run, transaction);
    this.activeExecutions.set(agentId, execution);
    void execution
      .finally(() => {
        if (this.activeExecutions.get(agentId) === execution) {
          this.activeExecutions.delete(agentId);
        }
      })
      .catch(() => undefined);
    return { run, message };
  }

  async systemInfo(): Promise<Record<string, unknown>> {
    return {
      arkConfigured: isArkConfigured(this.config),
      arkBaseUrl: this.config.arkBaseUrl,
      arkModel: this.config.arkModel || null,
      codexAvailable: await this.runner.isAvailable(),
      codexSandboxMode: this.config.codexSandboxMode,
      runtimeProvider: this.config.runtimeProvider,
      containerEngine:
        this.config.runtimeProvider === "container"
          ? this.config.containerEngine
          : null,
      runtime:
        this.config.runtimeProvider === "container"
          ? "Codex CLI in " + this.config.containerEngine + " Runtime"
          : "Codex CLI in application container",
      zeroCommit: {
        enabled: true,
        isolation: "shadow-workspace",
        commitAuthority: "control-plane",
        protectedPaths: ["AGENTS.md", ".zerocommit/**"],
        protectedResources: this.config.zeroCommitProtectedResources,
        currentEffectCoverage: [
          "filesystem",
          "node-process",
          "node-sensitive-read",
          "node-global-fetch-network",
        ],
        externalEffects:
          "unauthorized Node global-fetch requests are blocked before delivery; other network stacks are not yet mediated",
      },
    };
  }

  private async executeRun(
    agentAtStart: Agent,
    run: AgentRun,
    transaction: AgentTransaction,
  ): Promise<void> {
    let workspace: PreparedTransactionWorkspace | null = null;
    let runtimeObservation: RuntimeObservationSession | null = null;
    const startedAt = now();

    try {
      await this.store.mutate((database) => {
        const storedRun = requiredRun(database, run.id);
        const storedTransaction = requiredTransaction(database, transaction.id);
        storedRun.status = "running";
        storedRun.startedAt = startedAt;
        storedTransaction.status = "preparing";
        storedTransaction.startedAt = startedAt;
      });

      workspace = await this.workspaces.prepareTransaction(transaction.id, agentAtStart);
      runtimeObservation = await prepareRuntimeObservation({
        transactionId: transaction.id,
        transactionPath: workspace.transactionPath,
        workspaceRoot: workspace.shadowWorkspacePath,
        mode: "enforce",
        protectedResources: this.config.zeroCommitProtectedResources,
        allowedNetworkOrigins: this.config.zeroCommitAllowedNetworkOrigins,
      });
      await this.store.mutate((database) => {
        const storedTransaction = requiredTransaction(database, transaction.id);
        storedTransaction.status = "executing";
        storedTransaction.integrity.baselineHash = workspace?.baselineHash ?? null;
      });

      if (this.cancellationRequests.has(agentAtStart.id)) {
        throw new RunCancelledError();
      }

      let result: RunnerResult | null = null;
      let executionError: unknown = null;
      try {
        result = await this.runner.run({
agentId: agentAtStart.id,
transactionId: transaction.id,
workspacePath: workspace.shadowWorkspacePath,
prompt: run.prompt,
threadId: agentAtStart.codexThreadId,
runtimeObservation,
        });
      } catch (error) {
        executionError = error;
      }

      if (this.cancellationRequests.has(agentAtStart.id)) {
        throw new RunCancelledError();
      }

      await this.store.mutate((database) => {
        requiredTransaction(database, transaction.id).status = "verifying";
      });
      const inspection = await this.workspaces.inspectTransaction(workspace);
      const runtimeLedger = await readRuntimeEffectLedger(runtimeObservation);
      const verification = verifyObservedTransaction(
        inspection,
        runtimeLedger,
        runtimeObservation.mode,
        executionError,
      );
      const causalGraph = buildCausalEffectGraph(runtimeLedger, transaction.id, {
        taskLabel: "User task: " + run.prompt.slice(0, 160),
        commandLabel: "Agent runtime: Codex",
      });
      const verifiedAt = now();
      await this.store.mutate((database) => {
        const storedTransaction = requiredTransaction(database, transaction.id);
        storedTransaction.decision = verification.decision;
        storedTransaction.decisionReason = verification.reason;
        storedTransaction.violations = verification.violations;
        storedTransaction.effects = inspection.effects;
        storedTransaction.runtimeEffects = runtimeLedger.effects;
        storedTransaction.runtimeSummary = summarizeRuntimeEffects(runtimeLedger);
        storedTransaction.causalGraph = causalGraph;
        storedTransaction.integrity = {
baselineHash: inspection.baselineHash,
shadowHash: inspection.shadowHash,
realHashBeforeDecision: inspection.realHashBeforeDecision,
finalRealHash: null,
        };
        storedTransaction.verifiedAt = verifiedAt;
      });

      if (verification.decision === "abort") {
        throw new TransactionAbortedError(verification.reason, verification.violations);
      }
      if (!result) {
        throw executionError instanceof Error
? executionError
: new Error("Agent execution did not produce a result");
      }
      if (this.cancellationRequests.has(agentAtStart.id)) {
        throw new RunCancelledError();
      }
      await this.store.mutate((database) => {
        requiredTransaction(database, transaction.id).status = "committing";
      });
      const finalRealHash = await this.workspaces.promoteTransaction(
        workspace,
        inspection.shadowHash,
      );
      const completedAt = now();

      await this.store.mutate((database) => {
        const storedRun = requiredRun(database, run.id);
        const storedTransaction = requiredTransaction(database, transaction.id);
        const agent = requiredAgent(database, agentAtStart.id);

        storedTransaction.status = "committed";
        storedTransaction.realStateOutcome = "committed";
        storedTransaction.integrity.finalRealHash = finalRealHash;
        storedTransaction.completedAt = completedAt;

        storedRun.status = "completed";
        storedRun.output = result.output;
        storedRun.usage = result.usage;
        storedRun.completedAt = completedAt;
        database.messages.push({
          id: randomUUID(),
          agentId: agent.id,
          runId: run.id,
          role: "assistant",
          content: result.output,
          createdAt: completedAt,
        });
        agent.status = "ready";
        agent.codexThreadId = result.threadId;
        agent.lastError = null;
        agent.updatedAt = completedAt;
      });

      try {
        const finalizedHash = await this.workspaces.finalizeCommittedTransaction(
          workspace,
          finalRealHash,
        );
        await this.store
          .mutate((database) => {
            const storedTransaction = requiredTransaction(database, transaction.id);
            storedTransaction.cleanupStatus = "completed";
            storedTransaction.cleanupError = null;
            storedTransaction.integrity.finalRealHash = finalizedHash;
          })
          .catch(() => undefined);
      } catch (error) {
        const cleanupError = error instanceof Error ? error.message : String(error);
        await this.store
          .mutate((database) => {
            const storedTransaction = requiredTransaction(database, transaction.id);
            storedTransaction.cleanupStatus = "failed";
            storedTransaction.cleanupError = cleanupError;
            storedTransaction.realStateOutcome = "unknown";
            const agent = database.agents.find((item) => item.id === agentAtStart.id);
            if (agent && agent.status !== "stopped") {
              agent.status = "error";
              agent.lastError =
                ZERO_COMMIT_CLEANUP_ERROR_PREFIX + " " + cleanupError;
              agent.updatedAt = now();
            }
          })
          .catch(() => undefined);
      }
    } catch (error) {
      await this.store
        .mutate((database) => {
          const storedTransaction = requiredTransaction(database, transaction.id);
          if (storedTransaction.status !== "committed") {
            storedTransaction.status = "aborting";
          }
        })
        .catch(() => undefined);
      const completedAt = now();
      const cancelled = error instanceof RunCancelledError;
      const policyAbort = error instanceof TransactionAbortedError;
      const message = error instanceof Error ? error.message : String(error);
      let cleanupError: string | null = null;
      let finalRealHash: string | null = null;
      let baselineHash = workspace?.baselineHash ?? null;

      if (workspace) {
        try {
          finalRealHash = await this.workspaces.abortTransaction(workspace);
        } catch (cleanupFailure) {
          cleanupError =
            cleanupFailure instanceof Error ? cleanupFailure.message : String(cleanupFailure);
        }
      } else {
        try {
          finalRealHash = await this.workspaces.hashWorkspace(agentAtStart.workspacePath);
          baselineHash = finalRealHash;
        } catch (hashFailure) {
          cleanupError =
            hashFailure instanceof Error ? hashFailure.message : String(hashFailure);
        }
      }

      const containmentSucceeded =
        cleanupError === null &&
        baselineHash !== null &&
        finalRealHash !== null &&
        baselineHash === finalRealHash;
      const violations: TransactionViolation[] = policyAbort
        ? error.violations
        : [
            {
              code: cancelled
                ? "RUN_CANCELLED"
                : error instanceof WorkspaceIsolationError
                  ? "WORKSPACE_ISOLATION_FAILED"
                  : "EXECUTION_FAILED",
              message,
              path: null,
            },
          ];

      await this.store.mutate((database) => {
        const storedRun = requiredRun(database, run.id);
        const storedTransaction = requiredTransaction(database, transaction.id);
        const agent = database.agents.find((item) => item.id === agentAtStart.id);

        storedTransaction.status = "aborted";
        storedTransaction.decision = "abort";
        storedTransaction.decisionReason =
          storedTransaction.decisionReason ?? message;
        storedTransaction.violations =
          storedTransaction.violations.length > 0
            ? storedTransaction.violations
            : violations;
        storedTransaction.realStateOutcome = containmentSucceeded ? "unchanged" : "unknown";
        storedTransaction.integrity.baselineHash =
          storedTransaction.integrity.baselineHash ?? baselineHash;
        storedTransaction.integrity.finalRealHash = finalRealHash;
        storedTransaction.cleanupStatus = cleanupError ? "failed" : "completed";
        storedTransaction.cleanupError = cleanupError;
        storedTransaction.completedAt = completedAt;

        storedRun.status = cancelled ? "cancelled" : "failed";
        storedRun.error = message;
        storedRun.completedAt = completedAt;

        if (agent) {
          if (cleanupError) {
            if (agent.status !== "stopped") {
              agent.status = "error";
            }
            agent.lastError =
              ZERO_COMMIT_CLEANUP_ERROR_PREFIX + " " + cleanupError;
          } else {
            if (agent.status !== "stopped") {
              agent.status =
                cancelled || (policyAbort && containmentSucceeded) ? "ready" : "error";
            }
            agent.lastError = cancelled ? null : message;
          }
          agent.codexThreadId = null;
          agent.updatedAt = completedAt;
        }
      });
    }
  }

  private async setStatus(id: string, status: Agent["status"]): Promise<Agent> {
    return this.store.mutate((database) => {
      const agent = database.agents.find((item) => item.id === id);
      if (!agent) {
        throw new HttpError(404, "Agent not found");
      }
      if (
        status === "ready" &&
        (agent.status === "busy" ||
          this.activeExecutions.has(id) ||
          hasUnresolvedCleanup(database, id))
      ) {
        throw new HttpError(409, "Recover the active transaction before starting this Agent");
      }
      agent.status = status;
      if (status === "ready") agent.lastError = null;
      agent.updatedAt = now();
      return structuredClone(agent);
    });
  }

  private async cancelExecution(agentId: string): Promise<void> {
    this.cancellationRequests.add(agentId);
    try {
      await this.runner.cancel(agentId);
      const execution = this.activeExecutions.get(agentId);
      if (execution) {
        await execution;
      }
    } finally {
      this.cancellationRequests.delete(agentId);
    }
  }
}
