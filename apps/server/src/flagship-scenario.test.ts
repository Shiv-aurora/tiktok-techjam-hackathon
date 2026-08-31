import { describe, expect, it } from "vitest";
import { runFlagshipComparison } from "./flagship-scenario.js";

describe("ZeroCommit flagship hidden downstream attack", () => {
  it(
    "shows the same npm test chain leaking without enforcement and aborting with zero real damage under ZeroCommit",
    async () => {
      const result = await runFlagshipComparison();

      expect(result.zeroCommitOff.commandExitCode).toBe(0);
      expect(result.zeroCommitOff.dangerousOutcomeReached).toBe(true);
      expect(result.zeroCommitOff.receiverDeliveries).toBe(1);
      expect(result.zeroCommitOff.runtimeSummary.processesStarted).toBeGreaterThanOrEqual(3);
      expect(result.zeroCommitOff.runtimeSummary.sensitiveReads).toBe(1);
      expect(result.zeroCommitOff.runtimeSummary.unauthorizedNetworkAttempts).toBe(1);
      expect(result.zeroCommitOff.runtimeSummary.blockedNetworkAttempts).toBe(0);
      expect(result.zeroCommitOff.workspaceHashAfter).toBe(
        result.zeroCommitOff.workspaceHashBefore,
      );

      expect(result.zeroCommitOn.commandExitCode).toBe(0);
      expect(result.zeroCommitOn.receiverDeliveries).toBe(0);
      expect(result.zeroCommitOn.decision).toBe("abort");
      expect(result.zeroCommitOn.networkContained).toBe(true);
      expect(result.zeroCommitOn.realStateUnchanged).toBe(true);
      expect(result.zeroCommitOn.protectedCredentialUnchanged).toBe(true);
      expect(result.zeroCommitOn.runtimeSummary.processesStarted).toBeGreaterThanOrEqual(3);
      expect(result.zeroCommitOn.runtimeSummary.sensitiveReads).toBe(1);
      expect(result.zeroCommitOn.runtimeSummary.unauthorizedNetworkAttempts).toBe(1);
      expect(result.zeroCommitOn.runtimeSummary.blockedNetworkAttempts).toBe(1);

      const violationCodes = result.zeroCommitOn.violations.map(
        (violation) => violation.code,
      );
      expect(violationCodes).toContain("PROTECTED_RESOURCE_READ");
      expect(violationCodes).toContain("UNAUTHORIZED_NETWORK_ATTEMPT");
      expect(violationCodes).not.toContain("UNAUTHORIZED_NETWORK_ESCAPED");

      const attackPath = result.zeroCommitOn.causalGraph.attackPath.join(" -> ");
      expect(attackPath).toContain("User task");
      expect(attackPath).toContain("Agent action: npm test");
      expect(attackPath).toContain("Protected credential read");
      expect(attackPath).toContain("Blocked network attempt");

      const serializedEffects = JSON.stringify(result.zeroCommitOn.runtimeEffects);
      expect(serializedEffects).not.toContain(
        "zc_demo_credential_3d8f6b9e_not_a_real_secret",
      );
      expect(serializedEffects).not.toContain(
        "fixture_argument_must_be_redacted",
      );
      expect(serializedEffects).toContain("--token=<redacted>");
    },
    30_000,
  );
});
