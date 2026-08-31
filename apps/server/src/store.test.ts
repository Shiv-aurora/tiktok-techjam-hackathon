import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonStore } from "./store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("JsonStore", () => {
  it("does not publish a mutation in memory when persistence fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "launchpad-store-test-"));
    temporaryDirectories.push(root);
    const originalPath = path.join(root, "db.json");
    const store = new JsonStore(originalPath);
    await store.initialize();

    const mutableStore = store as unknown as { filePath: string };
    mutableStore.filePath = path.join(root, "missing-directory", "db.json");
    await expect(
      store.mutate((database) => {
        database.messages.push({
          id: "message-1",
          agentId: "agent-1",
          runId: "run-1",
          role: "user",
          content: "must not become visible",
          createdAt: new Date().toISOString(),
        });
      }),
    ).rejects.toThrow();
    expect(store.snapshot().messages).toEqual([]);

    mutableStore.filePath = originalPath;
    await store.mutate((database) => {
      database.messages.push({
        id: "message-2",
        agentId: "agent-1",
        runId: "run-2",
        role: "user",
        content: "queue recovered",
        createdAt: new Date().toISOString(),
      });
    });
    expect(store.snapshot().messages.map((message) => message.content)).toEqual([
      "queue recovered",
    ]);
  });

  it("migrates starter database version 1 without losing runs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "launchpad-store-migration-test-"));
    temporaryDirectories.push(root);
    const filePath = path.join(root, "db.json");
    const timestamp = new Date().toISOString();
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        agents: [],
        messages: [],
        runs: [
          {
            id: "run-1",
            agentId: "agent-1",
            status: "completed",
            prompt: "legacy",
            output: "done",
            error: null,
            usage: null,
            startedAt: timestamp,
            completedAt: timestamp,
            createdAt: timestamp,
          },
        ],
      }),
      "utf8",
    );

    const store = new JsonStore(filePath);
    await store.initialize();

    expect(store.snapshot()).toMatchObject({
      version: 2,
      transactions: [],
      runs: [{ id: "run-1", transactionId: null }],
    });
    const persisted = JSON.parse(await readFile(filePath, "utf8")) as {
      version: number;
      transactions: unknown[];
    };
    expect(persisted.version).toBe(2);
    expect(persisted.transactions).toEqual([]);
  });
});
