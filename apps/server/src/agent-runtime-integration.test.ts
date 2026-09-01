import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentService } from "./agent-service.js";
import { loadConfig } from "./config.js";
import { JsonStore } from "./store.js";
import type { AgentRunner } from "./types.js";
import { WorkspaceManager } from "./workspace.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function serviceWith(runner: AgentRunner): Promise<AgentService> {
  const root = await mkdtemp(path.join(tmpdir(), "zerocommit-agent-runtime-"));
  roots.push(root);
  const config = loadConfig({
    NODE_ENV: "test",
    APP_DATA_DIR: path.join(root, "data"),
    AGENT_WORKSPACE_ROOT: path.join(root, "workspaces"),
    CODEX_HOME: path.join(root, "codex"),
    ARK_API_KEY: "test-key",
    ARK_MODEL: "ep-test",
    ARK_BASE_URL: "https://ark.example.com/api/v3",
  });
  const service = new AgentService(
    config,
    new JsonStore(path.join(root, "data", "db.json")),
    new WorkspaceManager(path.join(root, "workspaces")),
    runner,
  );
  await service.initialize();
  return service;
}

const runtimeRecord = (transactionId: string, authorized: boolean, enforcement: "allowed" | "blocked") => JSON.stringify({
  id: "network-effect",
  transactionId,
  kind: "network.attempt",
  processId: 100,
  parentProcessId: 1,
  recordedAt: new Date().toISOString(),
  url: authorized ? "https://ark.example.com/api/v3" : "http://127.0.0.1:9999/collect",
  origin: authorized ? "https://ark.example.com" : "http://127.0.0.1:9999",
  method: "POST",
  authorized,
  enforcement,
  causedByEffectId: null,
}) + "\n";

describe("AgentService runtime evidence integration", () => {
  it("persists runtime evidence and aborts an unauthorized network attempt", async () => {
    const service = await serviceWith({
      run: async (request) => {
        if (!request.runtimeObservation) throw new Error("runtime observation missing");
        await appendFile(
request.runtimeObservation.effectLogPath,
runtimeRecord(request.runtimeObservation.transactionId, false, "blocked"),
        );
        return { output: "done", threadId: "thread", usage: null };
      },
      cancel: async () => false,
      isAvailable: async () => true,
    });
    const agent = await service.createAgent({ name: "Observed" });
    const { run } = await service.sendMessage(agent.id, "run the tests");
    await expect.poll(() => service.getRun(run.id).status).toBe("failed");
    const transaction = service.getTransaction(run.transactionId ?? "");
    expect(transaction).toMatchObject({
      decision: "abort",
      realStateOutcome: "unchanged",
      runtimeSummary: { networkAttempts: 1, unauthorizedNetworkAttempts: 1 },
    });
    expect(transaction.runtimeEffects[0]).toMatchObject({
      kind: "network.attempt",
      enforcement: "blocked",
    });
    expect(transaction.causalGraph?.attackPath.at(-1)).toContain("Blocked network attempt");
  });

  it("commits with an authorized runtime network effect", async () => {
    const service = await serviceWith({
      run: async (request) => {
        if (!request.runtimeObservation) throw new Error("runtime observation missing");
        await appendFile(
request.runtimeObservation.effectLogPath,
runtimeRecord(request.runtimeObservation.transactionId, true, "allowed"),
        );
        return { output: "done", threadId: "thread", usage: null };
      },
      cancel: async () => false,
      isAvailable: async () => true,
    });
    const agent = await service.createAgent({ name: "Allowed" });
    const { run } = await service.sendMessage(agent.id, "inspect safely");
    await expect.poll(() => service.getRun(run.id).status).toBe("completed");
    expect(service.getTransaction(run.transactionId ?? "")).toMatchObject({
      decision: "commit",
      runtimeSummary: { networkAttempts: 1, unauthorizedNetworkAttempts: 0 },
    });
  });
});
