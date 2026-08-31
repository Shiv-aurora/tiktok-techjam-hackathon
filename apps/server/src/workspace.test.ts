import {
  access,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Agent } from "./types.js";
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
