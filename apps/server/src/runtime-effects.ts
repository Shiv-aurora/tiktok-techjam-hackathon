import path from "node:path";

export type RuntimeEffectKind =
  | "process.started"
  | "process.spawned"
  | "process.exited"
  | "sensitive-resource.read"
  | "network.attempt";

interface RuntimeEffectBase {
  id: string;
  transactionId: string;
  kind: RuntimeEffectKind;
  processId: number;
  parentProcessId: number;
  parentEffectId: string | null;
  recordedAt: string;
}

export interface ProcessStartedEffect extends RuntimeEffectBase {
  kind: "process.started";
  executable: string;
  args: string[];
  cwd: string;
}

export interface ProcessSpawnedEffect extends RuntimeEffectBase {
  kind: "process.spawned";
  childProcessId: number | null;
  executable: string;
  args: string[];
  cwd: string;
}

export interface ProcessExitedEffect extends RuntimeEffectBase {
  kind: "process.exited";
  exitCode: number | null;
  startedEffectId: string | null;
}

export interface SensitiveResourceReadEffect extends RuntimeEffectBase {
  kind: "sensitive-resource.read";
  resourcePath: string;
  resourceKind: "credential";
  contentHash: string;
  bytes: number;
}

export interface NetworkAttemptEffect extends RuntimeEffectBase {
  kind: "network.attempt";
  url: string;
  origin: string;
  method: string;
  authorized: boolean;
  enforcement: "allowed" | "observed" | "blocked";
  causedByEffectId: string | null;
}

export type RuntimeEffect =
  | ProcessStartedEffect
  | ProcessSpawnedEffect
  | ProcessExitedEffect
  | SensitiveResourceReadEffect
  | NetworkAttemptEffect;

export interface RuntimeEffectLedger {
  effects: RuntimeEffect[];
  parseErrors: string[];
}

export interface RuntimeEffectSummary {
  processesStarted: number;
  processesSpawned: number;
  sensitiveReads: number;
  networkAttempts: number;
  blockedNetworkAttempts: number;
  unauthorizedNetworkAttempts: number;
}

export interface CausalEffectNode {
  id: string;
  kind: RuntimeEffectKind | "task.requested" | "agent.command";
  label: string;
  parentEffectId: string | null;
  risk: "normal" | "sensitive" | "dangerous" | "blocked";
}

export interface CausalEffectGraph {
  nodes: CausalEffectNode[];
  attackPath: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requiredString = (record: Record<string, unknown>, field: string): string => {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(field + " must be a non-empty string");
  }
  return value;
};

const requiredInteger = (record: Record<string, unknown>, field: string): number => {
  const value = record[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(field + " must be a non-negative integer");
  }
  return value;
};

const nullableInteger = (record: Record<string, unknown>, field: string): number | null => {
  const value = record[field];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(field + " must be an integer or null");
  }
  return value;
};

const nullableString = (record: Record<string, unknown>, field: string): string | null => {
  const value = record[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error(field + " must be a string or null");
  }
  return value;
};

const requiredStringArray = (
  record: Record<string, unknown>,
  field: string,
): string[] => {
  const value = record[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(field + " must be an array of strings");
  }
  return value as string[];
};

function parseRuntimeEffect(
  value: unknown,
  expectedTransactionId: string,
): RuntimeEffect {
  if (!isRecord(value)) throw new Error("effect must be an object");
  const id = requiredString(value, "id");
  const transactionId = requiredString(value, "transactionId");
  if (transactionId !== expectedTransactionId) {
    throw new Error("effect transactionId does not match the active transaction");
  }
  const kind = requiredString(value, "kind") as RuntimeEffectKind;
  const common = {
    id,
    transactionId,
    kind,
    processId: requiredInteger(value, "processId"),
    parentProcessId: requiredInteger(value, "parentProcessId"),
    parentEffectId: null,
    recordedAt: requiredString(value, "recordedAt"),
  };

  switch (kind) {
    case "process.started":
      return {
        ...common,
        kind,
        executable: requiredString(value, "executable"),
        args: requiredStringArray(value, "args"),
        cwd: requiredString(value, "cwd"),
      };
    case "process.spawned":
      return {
        ...common,
        kind,
        childProcessId: nullableInteger(value, "childProcessId"),
        executable: requiredString(value, "executable"),
        args: requiredStringArray(value, "args"),
        cwd: requiredString(value, "cwd"),
      };
    case "process.exited":
      return {
        ...common,
        kind,
        exitCode: nullableInteger(value, "exitCode"),
        startedEffectId: nullableString(value, "startedEffectId"),
      };
    case "sensitive-resource.read": {
      const resourceKind = requiredString(value, "resourceKind");
      if (resourceKind !== "credential") {
        throw new Error("resourceKind is not supported");
      }
      return {
        ...common,
        kind,
        resourcePath: requiredString(value, "resourcePath"),
        resourceKind,
        contentHash: requiredString(value, "contentHash"),
        bytes: requiredInteger(value, "bytes"),
      };
    }
    case "network.attempt": {
      const enforcement = requiredString(value, "enforcement");
      if (!["allowed", "observed", "blocked"].includes(enforcement)) {
        throw new Error("network enforcement value is not supported");
      }
      if (typeof value.authorized !== "boolean") {
        throw new Error("authorized must be a boolean");
      }
      return {
        ...common,
        kind,
        url: requiredString(value, "url"),
        origin: requiredString(value, "origin"),
        method: requiredString(value, "method"),
        authorized: value.authorized,
        enforcement: enforcement as NetworkAttemptEffect["enforcement"],
        causedByEffectId: nullableString(value, "causedByEffectId"),
      };
    }
    default:
      throw new Error("unsupported runtime effect kind: " + kind);
  }
}

export function parseRuntimeEffectLedger(
  content: string,
  expectedTransactionId: string,
): RuntimeEffectLedger {
  const effects: RuntimeEffect[] = [];
  const parseErrors: string[] = [];
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

  lines.forEach((line, index) => {
    try {
      effects.push(parseRuntimeEffect(JSON.parse(line) as unknown, expectedTransactionId));
    } catch (error) {
      parseErrors.push(
        "line " +
          (index + 1) +
          ": " +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  });

  const startedByProcess = new Map<number, string>();
  const spawnedByChild = new Map<number, string>();
  for (const effect of effects) {
    if (effect.kind === "process.started") {
      startedByProcess.set(effect.processId, effect.id);
    }
    if (effect.kind === "process.spawned" && effect.childProcessId !== null) {
      spawnedByChild.set(effect.childProcessId, effect.id);
    }
  }

  for (const effect of effects) {
    if (effect.kind === "process.started") {
      effect.parentEffectId =
        spawnedByChild.get(effect.processId) ??
        startedByProcess.get(effect.parentProcessId) ??
        null;
      continue;
    }
    if (effect.kind === "network.attempt" && effect.causedByEffectId) {
      effect.parentEffectId = effect.causedByEffectId;
      continue;
    }
    effect.parentEffectId = startedByProcess.get(effect.processId) ?? null;
  }

  return { effects, parseErrors };
}

export function summarizeRuntimeEffects(
  ledger: RuntimeEffectLedger,
): RuntimeEffectSummary {
  return {
    processesStarted: ledger.effects.filter((effect) => effect.kind === "process.started")
      .length,
    processesSpawned: ledger.effects.filter((effect) => effect.kind === "process.spawned")
      .length,
    sensitiveReads: ledger.effects.filter(
      (effect) => effect.kind === "sensitive-resource.read",
    ).length,
    networkAttempts: ledger.effects.filter((effect) => effect.kind === "network.attempt")
      .length,
    blockedNetworkAttempts: ledger.effects.filter(
      (effect) => effect.kind === "network.attempt" && effect.enforcement === "blocked",
    ).length,
    unauthorizedNetworkAttempts: ledger.effects.filter(
      (effect) => effect.kind === "network.attempt" && !effect.authorized,
    ).length,
  };
}

const commandLabel = (effect: ProcessStartedEffect | ProcessSpawnedEffect): string => {
  const executable = path.basename(effect.executable);
  const args = effect.args
    .slice(0, 3)
    .map((argument) => (argument.includes("/") ? path.basename(argument) : argument))
    .join(" ");
  return (effect.kind === "process.started" ? "Process: " : "Spawn: ") +
    executable +
    (args ? " " + args : "");
};

const runtimeNode = (effect: RuntimeEffect): CausalEffectNode => {
  switch (effect.kind) {
    case "process.started":
    case "process.spawned":
      return {
        id: effect.id,
        kind: effect.kind,
        label: commandLabel(effect),
        parentEffectId: effect.parentEffectId,
        risk: "normal",
      };
    case "process.exited":
      return {
        id: effect.id,
        kind: effect.kind,
        label: "Process exited with code " + (effect.exitCode ?? "unknown"),
        parentEffectId: effect.parentEffectId,
        risk: "normal",
      };
    case "sensitive-resource.read":
      return {
        id: effect.id,
        kind: effect.kind,
        label: "Protected credential read: " + effect.resourcePath,
        parentEffectId: effect.parentEffectId,
        risk: "sensitive",
      };
    case "network.attempt":
      return {
        id: effect.id,
        kind: effect.kind,
        label:
          (effect.enforcement === "blocked"
            ? "Blocked network attempt: "
            : "Unauthorized network attempt: ") + effect.origin,
        parentEffectId: effect.parentEffectId,
        risk: effect.enforcement === "blocked" ? "blocked" : "dangerous",
      };
  }
};

export function buildCausalEffectGraph(
  ledger: RuntimeEffectLedger,
  transactionId: string,
): CausalEffectGraph {
  const taskId = "task:" + transactionId;
  const commandId = "command:" + transactionId;
  const nodes: CausalEffectNode[] = [
    {
      id: taskId,
      kind: "task.requested",
      label: "User task: validate the authentication fix",
      parentEffectId: null,
      risk: "normal",
    },
    {
      id: commandId,
      kind: "agent.command",
      label: "Agent action: npm test",
      parentEffectId: taskId,
      risk: "normal",
    },
    ...ledger.effects.map(runtimeNode),
  ];

  const runtimeIds = new Set(ledger.effects.map((effect) => effect.id));
  for (const node of nodes) {
    if (
      node.kind !== "task.requested" &&
      node.kind !== "agent.command" &&
      (!node.parentEffectId || !runtimeIds.has(node.parentEffectId))
    ) {
      node.parentEffectId = commandId;
    }
  }

  const target = [...nodes]
    .reverse()
    .find(
      (node) =>
        node.kind === "network.attempt" &&
        (node.risk === "dangerous" || node.risk === "blocked"),
    );
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const attackPath: string[] = [];
  const visited = new Set<string>();
  let current = target;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    attackPath.unshift(current.label);
    current = current.parentEffectId ? byId.get(current.parentEffectId) : undefined;
  }

  return { nodes, attackPath };
}
