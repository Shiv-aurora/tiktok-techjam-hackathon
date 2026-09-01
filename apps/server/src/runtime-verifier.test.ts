import { describe, expect, it } from "vitest";
import { verifyObservedTransaction } from "./runtime-verifier.js";
import type { RuntimeEffectLedger } from "./runtime-effects.js";
import type { TransactionInspection } from "./workspace.js";

const inspection: TransactionInspection = {
  effects: [],
  baselineHash: "same",
  shadowHash: "same",
  realHashBeforeDecision: "same",
  protectedStateChanged: false,
};

const networkLedger = (authorized: boolean, enforcement: "allowed" | "observed" | "blocked"): RuntimeEffectLedger => ({
  parseErrors: [],
  effects: [{
    id: "effect-1",
    transactionId: "transaction-1",
    kind: "network.attempt",
    processId: 10,
    parentProcessId: 1,
    parentEffectId: null,
    recordedAt: new Date().toISOString(),
    url: "http://127.0.0.1:9999/collect",
    origin: "http://127.0.0.1:9999",
    method: "POST",
    authorized,
    enforcement,
    causedByEffectId: null,
  }],
});

describe("observed transaction verifier", () => {
  it("aborts a blocked unauthorized network attempt", () => {
    const result = verifyObservedTransaction(
      inspection,
      networkLedger(false, "blocked"),
      "enforce",
    );
    expect(result.decision).toBe("abort");
    expect(result.networkContained).toBe(true);
    expect(result.violations.map((item) => item.code)).toContain(
      "UNAUTHORIZED_NETWORK_ATTEMPT",
    );
  });

  it("allows an authorized network attempt", () => {
    const result = verifyObservedTransaction(
      inspection,
      networkLedger(true, "allowed"),
      "enforce",
    );
    expect(result).toMatchObject({ decision: "commit", violations: [] });
  });

  it("fails closed on malformed runtime evidence", () => {
    const result = verifyObservedTransaction(
      inspection,
      { effects: [], parseErrors: ["line 1: invalid"] },
      "enforce",
    );
    expect(result.decision).toBe("abort");
    expect(result.violations[0]?.code).toBe("MALFORMED_RUNTIME_EFFECT");
  });
});
