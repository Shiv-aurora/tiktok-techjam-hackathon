import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseRuntimeEffectLedger, type RuntimeEffectLedger } from "./runtime-effects.js";
import { RUNTIME_OBSERVER_SOURCE } from "./runtime-observer-source.js";

export type RuntimeObservationMode = "observe" | "enforce";

export interface RuntimeObservationSession {
  transactionId: string;
  transactionPath: string;
  observerPath: string;
  effectLogPath: string;
  workspaceRoot: string;
  mode: RuntimeObservationMode;
  protectedResources: string[];
  allowedNetworkOrigins: string[];
}

export interface PrepareRuntimeObservationInput {
  transactionId: string;
  transactionPath: string;
  workspaceRoot: string;
  mode: RuntimeObservationMode;
  protectedResources: string[];
  allowedNetworkOrigins: string[];
}

export async function prepareRuntimeObservation(
  input: PrepareRuntimeObservationInput,
): Promise<RuntimeObservationSession> {
  const transactionPath = path.resolve(input.transactionPath);
  const observerPath = path.join(transactionPath, "runtime-observer.cjs");
  const effectLogPath = path.join(transactionPath, "runtime-effects.jsonl");
  await mkdir(transactionPath, { recursive: true, mode: 0o700 });
  await writeFile(observerPath, RUNTIME_OBSERVER_SOURCE, {
    encoding: "utf8",
    mode: 0o400,
  });
  await chmod(observerPath, 0o400);
  await writeFile(effectLogPath, "", { encoding: "utf8", mode: 0o600 });

  return {
    transactionId: input.transactionId,
    transactionPath,
    observerPath,
    effectLogPath,
    workspaceRoot: path.resolve(input.workspaceRoot),
    mode: input.mode,
    protectedResources: [...input.protectedResources],
    allowedNetworkOrigins: [...input.allowedNetworkOrigins],
  };
}

export function buildRuntimeObservationEnvironment(
  session: RuntimeObservationSession,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
  additionalEnvironment: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...baseEnvironment,
    ...additionalEnvironment,
  };
  delete environment.NODE_OPTIONS;

  return {
    ...environment,
    NODE_OPTIONS: "--require=" + session.observerPath,
    ZEROCOMMIT_TRANSACTION_ID: session.transactionId,
    ZEROCOMMIT_EFFECT_LOG: session.effectLogPath,
    ZEROCOMMIT_WORKSPACE_ROOT: session.workspaceRoot,
    ZEROCOMMIT_MODE: session.mode,
    ZEROCOMMIT_PROTECTED_RESOURCES: JSON.stringify(session.protectedResources),
    ZEROCOMMIT_ALLOWED_NETWORK_ORIGINS: JSON.stringify(
      session.allowedNetworkOrigins,
    ),
  };
}

export async function readRuntimeEffectLedger(
  session: RuntimeObservationSession,
): Promise<RuntimeEffectLedger> {
  try {
    const content = await readFile(session.effectLogPath, "utf8");
    return parseRuntimeEffectLedger(content, session.transactionId);
  } catch (error) {
    return {
      effects: [],
      parseErrors: [
        "runtime effect ledger could not be read: " +
          (error instanceof Error ? error.message : String(error)),
      ],
    };
  }
}
