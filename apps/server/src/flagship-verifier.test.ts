import { describe, expect, it } from "vitest";
import { verifyFlagshipTransaction } from "./flagship-verifier.js";
import type { RuntimeEffectLedger } from "./runtime-effects.js";
import type { TransactionInspection } from "./workspace.js";

const cleanInspection: TransactionInspection = {
  effects: [],
  baselineHash: "baseline",
  shadowHash: "baseline",
  realHashBeforeDecision: "baseline",
  protectedStateChanged: false,
};

describe("flagship transaction verification", () => {
  it("fails closed when runtime evidence stops after process start", () => {
    const ledger: RuntimeEffectLedger = {
      parseErrors: [],
      effects: [
        {
          id: "effect-process",
          transactionId: "transaction-test",
          kind: "process.started",
          processId: 100,
          parentProcessId: 99,
          parentEffectId: null,
          recordedAt: "2026-08-31T00:00:00.000Z",
          executable: "/usr/bin/node",
          args: ["test-runner.cjs"],
          cwd: "/tmp/workspace",
        },
      ],
    };

    const result = verifyFlagshipTransaction(cleanInspection, ledger, "enforce");
    expect(result.decision).toBe("abort");
    expect(result.networkContained).toBe(false);
    expect(result.violations.map((violation) => violation.code)).toEqual(
      expect.arrayContaining([
        "EXPECTED_PROTECTED_READ_MISSING",
        "EXPECTED_NETWORK_ATTEMPT_MISSING",
      ]),
    );
  });

  it("fails closed when runtime evidence contains malformed records", () => {
    const result = verifyFlagshipTransaction(
      cleanInspection,
      { effects: [], parseErrors: ["line 2: invalid effect"] },
      "enforce",
    );

    expect(result.decision).toBe("abort");
    expect(result.violations.map((violation) => violation.code)).toContain(
      "MALFORMED_RUNTIME_EFFECT",
    );
  });
});
