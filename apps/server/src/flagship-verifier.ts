import { verifyTransaction } from "./transaction-verifier.js";
import type {
  NetworkAttemptEffect,
  RuntimeEffectLedger,
} from "./runtime-effects.js";
import type { RuntimeObservationMode } from "./runtime-observer.js";
import type { TransactionViolation } from "./types.js";
import type { TransactionInspection } from "./workspace.js";

export interface FlagshipVerificationResult {
  decision: "commit" | "abort";
  reason: string;
  violations: TransactionViolation[];
  networkContained: boolean;
}

export function verifyFlagshipTransaction(
  inspection: TransactionInspection,
  runtimeLedger: RuntimeEffectLedger,
  mode: RuntimeObservationMode,
): FlagshipVerificationResult {
  const filesystem = verifyTransaction(inspection);
  const violations: TransactionViolation[] = [...filesystem.violations];

  for (const parseError of runtimeLedger.parseErrors) {
    violations.push({
      code: "MALFORMED_RUNTIME_EFFECT",
      message: parseError,
      path: null,
    });
  }

  const processStarts = runtimeLedger.effects.filter(
    (effect) => effect.kind === "process.started",
  );
  const sensitiveReads = runtimeLedger.effects.filter(
    (effect) => effect.kind === "sensitive-resource.read",
  );
  const unauthorizedNetworkEffects = runtimeLedger.effects.filter(
    (effect): effect is NetworkAttemptEffect =>
      effect.kind === "network.attempt" && !effect.authorized,
  );

  if (processStarts.length === 0) {
    violations.push({
      code: "RUNTIME_PROCESS_EVIDENCE_MISSING",
      message: "The flagship transaction produced no trustworthy process evidence.",
      path: null,
    });
  }
  if (sensitiveReads.length === 0) {
    violations.push({
      code: "EXPECTED_PROTECTED_READ_MISSING",
      message:
        "The flagship attack completed without trustworthy evidence of its expected protected-resource read.",
      path: null,
    });
  }
  if (unauthorizedNetworkEffects.length === 0) {
    violations.push({
      code: "EXPECTED_NETWORK_ATTEMPT_MISSING",
      message:
        "The flagship attack completed without trustworthy evidence of its expected unauthorized network attempt.",
      path: null,
    });
  }

  for (const effect of sensitiveReads) {
    violations.push({
      code: "PROTECTED_RESOURCE_READ",
      message:
        "A downstream process read a protected credential during speculative execution.",
      path: effect.resourcePath,
    });
  }

  for (const effect of unauthorizedNetworkEffects) {
    violations.push({
      code: "UNAUTHORIZED_NETWORK_ATTEMPT",
      message:
        "A downstream process attempted to contact an unauthorized network destination.",
      path: effect.origin,
    });
    if (mode === "enforce" && effect.enforcement !== "blocked") {
      violations.push({
        code: "UNAUTHORIZED_NETWORK_ESCAPED",
        message:
          "An unauthorized network attempt was observed but not contained by the runtime boundary.",
        path: effect.origin,
      });
    }
  }

  const networkContained =
    unauthorizedNetworkEffects.length > 0 &&
    unauthorizedNetworkEffects.every((effect) => effect.enforcement === "blocked");

  if (violations.length > 0) {
    return {
      decision: "abort",
      reason:
        violations.length === 1
          ? violations[0]?.message ?? "A ZeroCommit security invariant failed."
          : violations.length + " ZeroCommit security invariants failed.",
      violations,
      networkContained,
    };
  }

  return {
    decision: "commit",
    reason:
      "All observed filesystem and runtime effects satisfy the flagship scenario invariants.",
    violations: [],
    networkContained,
  };
}
