import { describe, expect, it } from "vitest";
import { buildContainerRunArgs } from "./container-codex-runner.js";
import { loadConfig } from "./config.js";

describe("container runtime observation wiring", () => {
  it("mounts observer evidence outside the Agent workspace and injects policy environment", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      RUNTIME_PROVIDER: "container",
      CODEX_HOME: "/tmp/codex",
    });
    const args = buildContainerRunArgs({
      agentId: "agent",
      transactionId: "transaction",
      workspacePath: "/tmp/workspace",
      prompt: "test",
      threadId: null,
      runtimeObservation: {
        transactionId: "transaction",
        transactionPath: "/tmp/transaction",
        observerPath: "/tmp/transaction/runtime-observer.cjs",
        effectLogPath: "/tmp/transaction/runtime-effects.jsonl",
        workspaceRoot: "/tmp/workspace",
        mode: "enforce",
        protectedResources: ["protected/"],
        allowedNetworkOrigins: ["https://ark.example.com"],
      },
    }, config);

    expect(args).toContain(
      "type=bind,src=/tmp/transaction/runtime-observer.cjs,dst=/zerocommit/runtime-observer.cjs,readonly",
    );
    expect(args).toContain(
      "type=bind,src=/tmp/transaction/runtime-effects.jsonl,dst=/zerocommit/runtime-effects.jsonl",
    );
    expect(args).toContain("NODE_OPTIONS=--require=/zerocommit/runtime-observer.cjs");
    expect(args).toContain("ZEROCOMMIT_MODE=enforce");
    expect(args).toContain('ZEROCOMMIT_PROTECTED_RESOURCES=["protected/"]');
  });
});
