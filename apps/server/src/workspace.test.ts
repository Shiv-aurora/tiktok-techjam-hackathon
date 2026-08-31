import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Agent, AgentTransaction } from "./types.js";
import { WorkspaceIsolationError, WorkspaceManager } from "./workspace.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createWorkspace(): Promise<{
  manager: WorkspaceManager;
  agent: Agent;
  root: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "zerocommit-workspace-test-"));
  temporaryDirectories.push(root);
  const manager = new WorkspaceManager(path.join(root, "workspaces"));
  await manager.initialize();
  const timestamp = new Date().toISOString();
  const agent: Agent = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Workspace test",
    description: "",
    instructions: "",
    status: "ready",
    workspacePath: manager.workspacePath("11111111-1111-4111-8111-111111111111"),
    codexThreadId: null,
    lastError: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await manager.create(agent);
  return { manager, agent, root };
}

describe("transactional workspace", () => {
  it("can roll back a promoted shadow workspace", async () => {
    const { manager, agent } = await createWorkspace();
    const transaction = await manager.prepareTransaction(
      "22222222-2222-4222-8222-222222222222",
      agent,
    );
    await writeFile(path.join(transaction.shadowWorkspacePath, "candidate.txt"), "candidate\n");
    const inspection = await manager.inspectTransaction(transaction);

    await manager.promoteTransaction(transaction, inspection.shadowHash);
    expect(await readFile(path.join(agent.workspacePath, "candidate.txt"), "utf8")).toBe(
      "candidate\n",
    );
    const finalHash = await manager.abortTransaction(transaction);

    await expect(access(path.join(agent.workspacePath, "candidate.txt"))).rejects.toThrow();
    expect(finalHash).toBe(transaction.baselineHash);
  });


  it("refuses cleanup when committed real state no longer matches verification", async () => {
    const { manager, agent } = await createWorkspace();
    const transaction = await manager.prepareTransaction(
      "55555555-5555-4555-8555-555555555555",
      agent,
    );
    await writeFile(path.join(transaction.shadowWorkspacePath, "candidate.txt"), "verified\n");
    const inspection = await manager.inspectTransaction(transaction);

    await manager.promoteTransaction(transaction, inspection.shadowHash);
    await writeFile(path.join(agent.workspacePath, "candidate.txt"), "changed after commit\n");

    await expect(
      manager.finalizeCommittedTransaction(transaction, inspection.shadowHash),
    ).rejects.toBeInstanceOf(WorkspaceIsolationError);
    await expect(lstat(transaction.backupWorkspacePath)).resolves.toBeDefined();

    expect(await manager.abortTransaction(transaction)).toBe(transaction.baselineHash);
  });

  it("discards orphan transaction artifacts without trusting journal paths", async () => {
    const { manager, root } = await createWorkspace();
    const outsideDirectory = path.join(root, "outside-agent");
    const sentinel = path.join(outsideDirectory, "sentinel.txt");
    await mkdir(outsideDirectory);
    await writeFile(sentinel, "must survive\n");

    const orphanId = "untrusted-orphan";
    const orphanPath = path.join(
      root,
      "workspaces",
      ".zerocommit",
      "transactions",
      orphanId,
    );
    await mkdir(orphanPath, { recursive: true });
    await writeFile(
      path.join(orphanPath, "journal.json"),
      JSON.stringify({
        version: 1,
        transactionId: orphanId,
        agentId: "../../outside-agent",
      }),
    );

    expect(await manager.recoverTransactions([])).toEqual([
      expect.objectContaining({
        transactionId: orphanId,
        action: "discarded-orphan",
        error: null,
      }),
    ]);
    expect(await readFile(sentinel, "utf8")).toBe("must survive\n");
    await expect(lstat(orphanPath)).rejects.toThrow();
  });

  it("validates unresolved transactions whose recovery artifacts are missing", async () => {
    const { manager, agent } = await createWorkspace();
    const currentHash = await manager.hashWorkspace(agent.workspacePath);
    const timestamp = new Date().toISOString();
    const transaction = (
      id: string,
      overrides: Partial<AgentTransaction>,
    ): AgentTransaction => ({
      id,
      agentId: agent.id,
      runId: "99999999-9999-4999-8999-999999999999",
      status: "committed",
      decision: "commit",
      decisionReason: "verified",
      violations: [],
      effects: [],
      isolation: "shadow-workspace",
      realStateOutcome: "committed",
      integrity: {
        baselineHash: currentHash,
        shadowHash: currentHash,
        realHashBeforeDecision: currentHash,
        finalRealHash: currentHash,
      },
      cleanupStatus: "pending",
      cleanupError: null,
      startedAt: timestamp,
      verifiedAt: timestamp,
      completedAt: timestamp,
      createdAt: timestamp,
      ...overrides,
    });
    const committed = transaction(
      "66666666-6666-4666-8666-666666666666",
      {},
    );
    const preparing = transaction(
      "77777777-7777-4777-8777-777777777777",
      {
        status: "preparing",
        decision: null,
        decisionReason: null,
        realStateOutcome: null,
        integrity: {
          baselineHash: null,
          shadowHash: null,
          realHashBeforeDecision: null,
          finalRealHash: null,
        },
        verifiedAt: null,
        completedAt: null,
      },
    );
    const mismatched = transaction(
      "88888888-8888-4888-8888-888888888888",
      {
        integrity: {
          baselineHash: currentHash,
          shadowHash: "not-the-current-workspace",
          realHashBeforeDecision: currentHash,
          finalRealHash: "not-the-current-workspace",
        },
      },
    );

    expect(
      await manager.recoverTransactions([committed, preparing, mismatched]),
    ).toEqual([
      expect.objectContaining({
        transactionId: committed.id,
        action: "validated-commit",
        finalRealHash: currentHash,
        error: null,
      }),
      expect.objectContaining({
        transactionId: preparing.id,
        action: "validated-abort",
        finalRealHash: currentHash,
        error: null,
      }),
      expect.objectContaining({
        transactionId: mismatched.id,
        action: "failed",
        finalRealHash: null,
      }),
    ]);
  });

  it("rejects existing symlinks that escape the protected workspace", async () => {
    const { manager, agent, root } = await createWorkspace();
    const outside = path.join(root, "outside.txt");
    await writeFile(outside, "protected\n");
    await symlink(outside, path.join(agent.workspacePath, "escape"));

    await expect(
      manager.prepareTransaction("33333333-3333-4333-8333-333333333333", agent),
    ).rejects.toBeInstanceOf(WorkspaceIsolationError);
    expect(await readFile(outside, "utf8")).toBe("protected\n");
  });

  it("rejects existing absolute symlinks even when they point inside the workspace", async () => {
    const { manager, agent } = await createWorkspace();
    const target = path.join(agent.workspacePath, "inside.txt");
    await writeFile(target, "inside\n");
    await symlink(target, path.join(agent.workspacePath, "absolute-link"));

    await expect(
      manager.prepareTransaction("44444444-4444-4444-8444-444444444444", agent),
    ).rejects.toBeInstanceOf(WorkspaceIsolationError);
  });
});
