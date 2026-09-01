import { verifyTransaction } from "./transaction-verifier.js";
import type {
  NetworkAttemptEffect,
  RuntimeEffectLedger,
} from "./runtime-effects.js";
import type { RuntimeObservationMode } from "./runtime-observer.js";
import type { TransactionViolation } from "./types.js";
import type { TransactionInspection } from "./workspace.js";

export interface ObservedTransactionVerificationResult {
  decision: "commit" | "abort";
  reason: string;
  violations: TransactionViolation[];
  networkContained: boolean;
}

export function verifyObservedTransaction(
  inspection: TransactionInspection,
  runtimeLedger: RuntimeEffectLedger,
  mode: RuntimeObservationMode,
  executionError: unknown = null,
): ObservedTransactionVerificationResult {
  const filesystem = verifyTransaction(inspection);
  const violations: TransactionViolation[] = [...filesystem.violations];

  for (const parseError of runtimeLedger.parseErrors) {
    violations.push({
      code: "MALFORMED_RUNTIME_EFFECT",
      message: parseError,
      path: null,
    });
  }

  const sensitiveReads = runtimeLedger.effects.filter(
    (effect) => effect.kind === "sensitive-resource.read",
  );
  const unauthorizedNetworkEffects = runtimeLedger.effects.filter(
    (effect): effect is NetworkAttemptEffect =>
      effect.kind === "network.attempt" && !effect.authorized,
  );

  for (const effect of sensitiveReads) {
    violations.push({
      code: "PROTECTED_RESOURCE_READ",
      message: "A speculative process read a protected resource.",
      path: effect.resourcePath,
    });
  }

  for (const effect of unauthorizedNetworkEffects) {
    violations.push({
      code: "UNAUTHORIZED_NETWORK_ATTEMPT",
      message: "A speculative process attempted an unauthorized network destination.",
      path: effect.origin,
    });
    if (mode === "enforce" && effect.enforcement !== "blocked") {
      violations.push({
        code: "UNAUTHORIZED_NETWORK_ESCAPED",
        message: "An unauthorized network attempt was observed but not contained.",
        path: effect.origin,
      });
    }
  }

  if (executionError !== null) {
    const detail = executionError instanceof Error ? executionError.message : String(executionError);
    violations.push({
      code: "EXECUTION_FAILED",
      message: "Agent execution failed before the transaction could commit: " + detail,
      path: null,
    });
  }

  const networkContained =
    unauthorizedNetworkEffects.length === 0 ||
    unauthorizedNetworkEffects.every((effect) => effect.enforcement === "blocked");

  if (violations.length > 0) {
    return {
      decision: "abort",
      reason:
        violations.length === 1
? violations[0]?.message ?? "A ZeroCommit invariant failed."
: violations.length + " ZeroCommit invariants failed.",
      violations,
      networkContained,
    };
  }

  return {
    decision: "commit",
    reason: "Observed filesystem and runtime effects satisfy the active ZeroCommit invariants.",
    violations: [],
    networkContained,
  };
}
