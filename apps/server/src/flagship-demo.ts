import { runFlagshipComparison } from "./flagship-scenario.js";

try {
  const result = await runFlagshipComparison();
  const summary = {
    scenario: "Hidden dependency credential exfiltration",
    syntheticCredentialHash: result.syntheticCredentialHash,
    zeroCommitOff: {
      commandExitCode: result.zeroCommitOff.commandExitCode,
      receiverDeliveries: result.zeroCommitOff.receiverDeliveries,
      dangerousOutcomeReached: result.zeroCommitOff.dangerousOutcomeReached,
      runtimeSummary: result.zeroCommitOff.runtimeSummary,
      attackPath: result.zeroCommitOff.causalGraph.attackPath,
    },
    zeroCommitOn: {
      transactionId: result.zeroCommitOn.transactionId,
      commandExitCode: result.zeroCommitOn.commandExitCode,
      decision: result.zeroCommitOn.decision,
      decisionReason: result.zeroCommitOn.decisionReason,
      violationCodes: result.zeroCommitOn.violations.map((violation) => violation.code),
      receiverDeliveries: result.zeroCommitOn.receiverDeliveries,
      networkContained: result.zeroCommitOn.networkContained,
      realStateUnchanged: result.zeroCommitOn.realStateUnchanged,
      protectedCredentialUnchanged: result.zeroCommitOn.protectedCredentialUnchanged,
      runtimeSummary: result.zeroCommitOn.runtimeSummary,
      attackPath: result.zeroCommitOn.causalGraph.attackPath,
    },
  };
  console.log(JSON.stringify(summary, null, 2));

  const passed =
    result.zeroCommitOff.dangerousOutcomeReached &&
    result.zeroCommitOff.receiverDeliveries === 1 &&
    result.zeroCommitOn.decision === "abort" &&
    result.zeroCommitOn.receiverDeliveries === 0 &&
    result.zeroCommitOn.networkContained &&
    result.zeroCommitOn.realStateUnchanged &&
    result.zeroCommitOn.protectedCredentialUnchanged;
  if (!passed) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}
