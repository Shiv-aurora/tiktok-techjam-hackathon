import { describe, expect, it } from "vitest";
import {
  buildCausalEffectGraph,
  type RuntimeEffectLedger,
} from "./runtime-effects.js";

describe("runtime effect graph", () => {
  it("does not label an allowlisted network request as an attack", () => {
    const ledger: RuntimeEffectLedger = {
      parseErrors: [],
      effects: [
        {
          id: "network-allowed",
          transactionId: "transaction-test",
          kind: "network.attempt",
          processId: 100,
          parentProcessId: 99,
          parentEffectId: null,
          recordedAt: "2026-08-31T00:00:00.000Z",
          url: "https://api.example.test/health",
          origin: "https://api.example.test",
          method: "GET",
          authorized: true,
          enforcement: "allowed",
          causedByEffectId: null,
        },
      ],
    };

    const graph = buildCausalEffectGraph(ledger, "transaction-test");
    expect(graph.nodes.find((node) => node.id === "network-allowed")).toMatchObject({
      label: "Allowed network request: https://api.example.test",
      risk: "normal",
    });
    expect(graph.attackPath).toEqual([]);
  });
});
