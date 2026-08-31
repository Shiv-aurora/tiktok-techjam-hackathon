import {
  access,
  chmod,
  link,
  lstat,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AgentService } from "./agent-service.js";
import { loadConfig } from "./config.js";
import { JsonStore } from "./store.js";
import type {
  AgentRunner,
  AgentTransaction,
  RunnerRequest,
  RunnerResult,
} from "./types.js";
import { WorkspaceManager } from "./workspace.js";

class FakeRunner implements AgentRunner {
  async run(request: RunnerRequest): Promise<RunnerResult> {
    return {
      output: "Completed: " + request.prompt,
      threadId: request.threadId ?? "fake-thread",
      usage: { inputTokens: 12, outputTokens: 5 },
    };
  }
  async cancel(): Promise<boolean> {
    return false;
  }
  async isAvailable(): Promise<boolean> {
    return true;
  }
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

interface ServiceHarness {
  service: AgentService;
  store: JsonStore;
  workspaces: WorkspaceManager;
}

async function makeHarness(
  runner: AgentRunner = new FakeRunner(),
): Promise<ServiceHarness> {
  const root = await mkdtemp(path.join(tmpdir(), "launchpad-test-"));
  temporaryDirectories.push(root);
  const config = loadConfig({
    NODE_ENV: "test",
    APP_DATA_DIR: path.join(root, "data"),
    AGENT_WORKSPACE_ROOT: path.join(root, "workspaces"),
    CODEX_HOME: path.join(root, "codex"),
    ARK_API_KEY: "test-key",
    ARK_MODEL: "ep-test",
  });
  const store = new JsonStore(path.join(root, "data", "db.json"));
  const workspaces = new WorkspaceManager(path.join(root, "workspaces"));
  const service = new AgentService(config, store, workspaces, runner);
  await service.initialize();
  return { service, store, workspaces };
}

async function makeService(runner: AgentRunner = new FakeRunner()): Promise<AgentService> {
  return (await makeHarness(runner)).service;
}

describe("Agent lifecycle", () => {
  it("creates, updates, stops, starts and deletes an Agent", async () => {
    const service = await makeService();
    const agent = await service.createAgent({ name: "Builder" });
    expect(service.listAgents()).toHaveLength(1);
    expect((await service.updateAgent(agent.id, { description: "Builds apps" })).description)
      .toBe("Builds apps");
    expect((await service.stopAgent(agent.id)).status).toBe("stopped");
    expect((await service.startAgent(agent.id)).status).toBe("ready");
    await service.deleteAgent(agent.id);
    expect(service.listAgents()).toHaveLength(0);
  });

  it("persists a playground conversation through a committed transaction", async () => {
    const service = await makeService();
    const agent = await service.createAgent({ name: "Coder" });
    const { run } = await service.sendMessage(agent.id, "write hello world");
    await expect.poll(() => service.getRun(run.id).status).toBe("completed");
    const messages = service.getMessages(agent.id);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[1]?.content).toContain("write hello world");
    expect(service.getAgent(agent.id).codexThreadId).toBe("fake-thread");
    expect(run.transactionId).not.toBeNull();
    expect(service.getTransaction(run.transactionId ?? "")).toMatchObject({
      status: "committed",
      decision: "commit",
      realStateOutcome: "committed",
      cleanupStatus: "completed",
    });
  });

  it("commits safe shadow-workspace mutations into real state", async () => {
    const service = await makeService({
      run: async (request) => {
        await writeFile(path.join(request.workspacePath, "result.txt"), "safe result\n");
        return { output: "done", threadId: "safe-thread", usage: null };
      },
      cancel: async () => false,
      isAvailable: async () => true,
    });
    const agent = await service.createAgent({ name: "Safe writer" });
    const { run } = await service.sendMessage(agent.id, "write a safe result");

    await expect.poll(() => service.getRun(run.id).status).toBe("completed");
    expect(await readFile(path.join(agent.workspacePath, "result.txt"), "utf8")).toBe(
      "safe result\n",
    );
    const transaction = service.getTransaction(run.transactionId ?? "");
    expect(transaction.status).toBe("committed");
    expect(transaction.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "create",
          path: "result.txt",
          protected: false,
        }),
      ]),
    );
    expect(transaction.integrity.finalRealHash).toBe(transaction.integrity.shadowHash);
  });

  it("aborts protected-path mutations and proves real state stayed unchanged", async () => {
    const service = await makeService({
      run: async (request) => {
        await writeFile(path.join(request.workspacePath, "AGENTS.md"), "tampered\n");
        await writeFile(path.join(request.workspacePath, "unsafe.txt"), "must not persist\n");
        return { output: "changed protected files", threadId: "tainted-thread", usage: null };
      },
      cancel: async () => false,
      isAvailable: async () => true,
    });
    const agent = await service.createAgent({ name: "Protected writer" });
    const originalInstructions = await readFile(
      path.join(agent.workspacePath, "AGENTS.md"),
      "utf8",
    );
    const { run } = await service.sendMessage(agent.id, "change the platform instructions");

    await expect.poll(() => service.getRun(run.id).status).toBe("failed");
    expect(await readFile(path.join(agent.workspacePath, "AGENTS.md"), "utf8")).toBe(
      originalInstructions,
    );
    await expect(access(path.join(agent.workspacePath, "unsafe.txt"))).rejects.toThrow();
    const transaction = service.getTransaction(run.transactionId ?? "");
    expect(transaction).toMatchObject({
      status: "aborted",
      decision: "abort",
      realStateOutcome: "unchanged",
      cleanupStatus: "completed",
    });
    expect(transaction.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PROTECTED_PATH_MUTATION",
          path: "AGENTS.md",
        }),
      ]),
    );
    expect(transaction.integrity.finalRealHash).toBe(transaction.integrity.baselineHash);
    expect(service.getAgent(agent.id)).toMatchObject({
      status: "ready",
      codexThreadId: null,
    });
  });

  it("detects permission-only changes to protected files", async () => {
    const service = await makeService({
      run: async (request) => {
        await chmod(path.join(request.workspacePath, "AGENTS.md"), 0o777);
        return { output: "changed mode", threadId: "tainted-thread", usage: null };
      },
      cancel: async () => false,
      isAvailable: async () => true,
    });
    const agent = await service.createAgent({ name: "Mode changer" });
    const { run } = await service.sendMessage(agent.id, "make instructions executable");

    await expect.poll(() => service.getRun(run.id).status).toBe("failed");
    const transaction = service.getTransaction(run.transactionId ?? "");
    expect(transaction.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PROTECTED_PATH_MUTATION", path: "AGENTS.md" }),
      ]),
    );
    expect(transaction.integrity.finalRealHash).toBe(transaction.integrity.baselineHash);
  });

  it("aborts absolute and escaping symlinks created in shadow state", async () => {
    const service = await makeService({
      run: async (request) => {
        await symlink(
          path.join(request.workspacePath, "README.md"),
          path.join(request.workspacePath, "absolute-link"),
        );
        await symlink("../outside-shadow", path.join(request.workspacePath, "escape-link"));
        return { output: "created links", threadId: "tainted-thread", usage: null };
      },
      cancel: async () => false,
      isAvailable: async () => true,
    });
    const agent = await service.createAgent({ name: "Link creator" });
    const { run } = await service.sendMessage(agent.id, "create links");

    await expect.poll(() => service.getRun(run.id).status).toBe("failed");
    const transaction = service.getTransaction(run.transactionId ?? "");
    expect(transaction.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "ABSOLUTE_SYMLINK", path: "absolute-link" }),
        expect.objectContaining({ code: "EXTERNAL_SYMLINK", path: "escape-link" }),
      ]),
    );
    await expect(lstat(path.join(agent.workspacePath, "absolute-link"))).rejects.toThrow();
    await expect(lstat(path.join(agent.workspacePath, "escape-link"))).rejects.toThrow();
  });

  it("aborts hard links so committed files remain transaction-owned", async () => {
    const service = await makeService({
      run: async (request) => {
        const source = path.join(request.workspacePath, "hardlink-source.txt");
        await writeFile(source, "shared inode\n");
        await link(source, path.join(request.workspacePath, "hardlink-copy.txt"));
        return { output: "created hard link", threadId: "tainted-thread", usage: null };
      },
      cancel: async () => false,
      isAvailable: async () => true,
    });
    const agent = await service.createAgent({ name: "Hard link creator" });
    const { run } = await service.sendMessage(agent.id, "create hard links");

    await expect.poll(() => service.getRun(run.id).status).toBe("failed");
    const transaction = service.getTransaction(run.transactionId ?? "");
    expect(transaction.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "HARD_LINK" })]),
    );
    await expect(access(path.join(agent.workspacePath, "hardlink-source.txt"))).rejects.toThrow();
    await expect(access(path.join(agent.workspacePath, "hardlink-copy.txt"))).rejects.toThrow();
  });


  it("keeps the Agent locked until committed transaction cleanup finishes", async () => {
    let releaseCleanup!: () => void;
    const cleanupGate = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const { service, workspaces } = await makeHarness();
    const finalize = workspaces.finalizeCommittedTransaction.bind(workspaces);
    workspaces.finalizeCommittedTransaction = async (workspace, expectedRealHash) => {
      await cleanupGate;
      return finalize(workspace, expectedRealHash);
    };
    const agent = await service.createAgent({ name: "Cleanup lock" });
    const { run } = await service.sendMessage(agent.id, "finish one transaction");

    await expect.poll(() => service.getRun(run.id).status).toBe("completed");
    await expect(
      service.sendMessage(agent.id, "must not overlap cleanup"),
    ).rejects.toMatchObject({ statusCode: 409 });

    releaseCleanup();
    await expect
      .poll(() => service.getTransaction(run.transactionId ?? "").cleanupStatus)
      .toBe("completed");
  });

  it("fails closed when transaction recovery cannot be trusted", async () => {
    const { service, store, workspaces } = await makeHarness();
    const agent = await service.createAgent({ name: "Recovery guard" });
    const timestamp = new Date().toISOString();
    const transaction: AgentTransaction = {
      id: "99999999-9999-4999-8999-999999999999",
      agentId: agent.id,
      runId: "88888888-8888-4888-8888-888888888888",
      status: "committing",
      decision: "commit",
      decisionReason: "verification passed",
      violations: [],
      effects: [],
      isolation: "shadow-workspace",
      realStateOutcome: null,
      integrity: {
        baselineHash: "baseline",
        shadowHash: "shadow",
        realHashBeforeDecision: "baseline",
        finalRealHash: null,
      },
      cleanupStatus: "pending",
      cleanupError: null,
      startedAt: timestamp,
      verifiedAt: timestamp,
      completedAt: null,
      createdAt: timestamp,
    };
    await store.mutate((database) => {
      database.transactions.push(transaction);
      const storedAgent = database.agents.find((item) => item.id === agent.id);
      if (storedAgent) storedAgent.status = "busy";
    });
    workspaces.recoverTransactions = async () => [
      {
        transactionId: transaction.id,
        action: "failed",
        finalRealHash: null,
        error: "journal mismatch",
      },
    ];

    await service.initialize();

    expect(service.getAgent(agent.id)).toMatchObject({
      status: "error",
      codexThreadId: null,
      lastError: expect.stringContaining("ZeroCommit recovery failed"),
    });
    expect(service.getTransaction(transaction.id)).toMatchObject({
      status: "aborted",
      cleanupStatus: "failed",
      realStateOutcome: "unknown",
    });
    await expect(service.startAgent(agent.id)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("atomically accepts only one concurrent run per Agent", async () => {
    let finish!: (result: RunnerResult) => void;
    const pending = new Promise<RunnerResult>((resolve) => {
      finish = resolve;
    });
    const runner: AgentRunner = {
      run: () => pending,
      cancel: async () => false,
      isAvailable: async () => true,
    };
    const service = await makeService(runner);
    const agent = await service.createAgent({ name: "Concurrent" });
    const attempts = await Promise.allSettled([
      service.sendMessage(agent.id, "first"),
      service.sendMessage(agent.id, "second"),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejected).toMatchObject({ reason: { statusCode: 409 } });
    expect(service.getMessages(agent.id)).toHaveLength(1);

    finish({ output: "done", threadId: "thread", usage: null });
    const accepted = attempts.find((attempt) => attempt.status === "fulfilled");
    if (accepted?.status === "fulfilled") {
      await expect.poll(() => service.getRun(accepted.value.run.id).status).toBe("completed");
    }
  });

  it("does not let start reset a busy Agent and admit a second run", async () => {
    let finish!: (result: RunnerResult) => void;
    const pending = new Promise<RunnerResult>((resolve) => {
      finish = resolve;
    });
    const service = await makeService({
      run: () => pending,
      cancel: async () => false,
      isAvailable: async () => true,
    });
    const agent = await service.createAgent({ name: "Busy" });
    const { run } = await service.sendMessage(agent.id, "first");

    await expect(service.startAgent(agent.id)).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.sendMessage(agent.id, "second")).rejects.toMatchObject({
      statusCode: 409,
    });

    finish({ output: "done", threadId: "thread", usage: null });
    await expect.poll(() => service.getRun(run.id).status).toBe("completed");
  });
});
