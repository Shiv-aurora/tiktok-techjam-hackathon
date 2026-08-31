import type {
  TransactionInspection,
} from "./workspace.js";
import type {
  TransactionDecision,
  TransactionViolation,
} from "./types.js";

export interface TransactionVerificationResult {
  decision: Exclude<TransactionDecision, null>;
  reason: string;
  violations: TransactionViolation[];
}

export function verifyTransaction(
  inspection: TransactionInspection,
): TransactionVerificationResult {
  const violations: TransactionViolation[] = [];

  if (inspection.protectedStateChanged) {
    violations.push({
      code: "REAL_STATE_DIVERGED_DURING_EXECUTION",
      message:
        "The protected workspace changed while the agent was executing in shadow state.",
      path: null,
    });
  }

  for (const effect of inspection.effects) {
    if (effect.protected) {
      violations.push({
        code: "PROTECTED_PATH_MUTATION",
        message: "The transaction attempted to mutate a platform-managed path.",
        path: effect.path,
      });
    }
    if (
      effect.objectType === "symlink" &&
      effect.operation !== "delete" &&
      effect.symlinkAbsolute
    ) {
      violations.push({
        code: "ABSOLUTE_SYMLINK",
        message:
          "The transaction created an absolute symlink that would not survive promotion safely.",
        path: effect.path,
      });
    }
    if (
      effect.objectType === "symlink" &&
      effect.operation !== "delete" &&
      effect.symlinkEscapesWorkspace
    ) {
      violations.push({
        code: "EXTERNAL_SYMLINK",
        message: "The transaction created a symlink outside the shadow workspace.",
        path: effect.path,
      });
    }
    if (
      effect.objectType === "file" &&
      effect.operation !== "delete" &&
      (effect.afterLinkCount ?? 0) > 1
    ) {
      violations.push({
        code: "HARD_LINK",
        message:
          "The transaction created or modified a hard-linked file whose backing inode is not transaction-owned.",
        path: effect.path,
      });
    }
    if (effect.objectType === "special" && effect.operation !== "delete") {
      violations.push({
        code: "SPECIAL_FILE",
        message: "The transaction created or modified an unsupported special file.",
        path: effect.path,
      });
    }
  }

  if (violations.length > 0) {
    return {
      decision: "abort",
      reason:
        violations.length === 1
          ? violations[0]?.message ?? "A deterministic security invariant failed."
          : violations.length + " deterministic security invariants failed.",
      violations,
    };
  }

  return {
    decision: "commit",
    reason: "All observed filesystem effects satisfy the current deterministic invariants.",
    violations: [],
  };
}
