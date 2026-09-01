import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonStore } from "./store.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("database v2 runtime evidence migration", () => {
  it("adds empty runtime evidence without changing the existing transaction decision", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zerocommit-v2-migration-"));
    roots.push(root);
    const filePath = path.join(root, "db.json");
    const timestamp = new Date().toISOString();
    await writeFile(filePath, JSON.stringify({
      version: 2,
      agents: [],
      messages: [],
      runs: [],
      transactions: [{
        id: "transaction-1",
        agentId: "agent-1",
        runId: "run-1",
        status: "committed",
        decision: "commit",
        decisionReason: "safe",
        violations: [],
        effects: [],
        isolation: "shadow-workspace",
        realStateOutcome: "committed",
        integrity: {
baselineHash: "a",
shadowHash: "b",
realHashBeforeDecision: "a",
finalRealHash: "b",
        },
        cleanupStatus: "completed",
        cleanupError: null,
        startedAt: timestamp,
        verifiedAt: timestamp,
        completedAt: timestamp,
        createdAt: timestamp,
      }],
    }), "utf8");

    const store = new JsonStore(filePath);
    await store.initialize();
    const transaction = store.snapshot().transactions[0];
    expect(store.snapshot().version).toBe(3);
    expect(transaction).toMatchObject({
      decision: "commit",
      runtimeEffects: [],
      causalGraph: null,
      runtimeSummary: {
        networkAttempts: 0,
        unauthorizedNetworkAttempts: 0,
      },
    });
    expect(JSON.parse(await readFile(filePath, "utf8")).version).toBe(3);
  });
});
