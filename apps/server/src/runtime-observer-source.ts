function runtimeObserverBootstrap(): void {
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const crypto = require("node:crypto") as typeof import("node:crypto");
  const childProcess = require("node:child_process") as typeof import("node:child_process");

  const guard = Symbol.for("zerocommit.runtime-observer.loaded");
  const globals = globalThis as typeof globalThis & Record<PropertyKey, unknown>;
  if (globals[guard]) return;
  globals[guard] = true;

  const transactionId = process.env.ZEROCOMMIT_TRANSACTION_ID ?? "unscoped";
  const effectLogPath = process.env.ZEROCOMMIT_EFFECT_LOG ?? "";
  const workspaceRoot = path.resolve(
    process.env.ZEROCOMMIT_WORKSPACE_ROOT ?? process.cwd(),
  );
  const mode = process.env.ZEROCOMMIT_MODE === "enforce" ? "enforce" : "observe";

  const parseStringArray = (name: string): string[] => {
    try {
      const parsed = JSON.parse(process.env[name] ?? "[]") as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : [];
    } catch {
      return [];
    }
  };

  const normalizeRelative = (value: string): string =>
    value.replaceAll("\\", "/").replace(/^\.\//, "");
  const protectedResources = parseStringArray("ZEROCOMMIT_PROTECTED_RESOURCES").map(
    normalizeRelative,
  );
  const allowedOrigins = new Set(
    parseStringArray("ZEROCOMMIT_ALLOWED_NETWORK_ORIGINS").map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return value;
      }
    }),
  );
  const appendEffect = fs.appendFileSync.bind(fs);

  const emit = (kind: string, fields: Record<string, unknown>): string => {
    const id = crypto.randomUUID();
    if (!effectLogPath) return id;
    const record = {
      id,
      transactionId,
      kind,
      processId: process.pid,
      parentProcessId: process.ppid,
      recordedAt: new Date().toISOString(),
      ...fields,
    };
    try {
      appendEffect(effectLogPath, JSON.stringify(record) + "\n", {
        encoding: "utf8",
        mode: 0o600,
      });
    } catch {
      // Observation must not crash the process solely because telemetry storage failed.
      // The control plane treats a missing or malformed ledger as a verification failure.
    }
    return id;
  };

  const startedEffectId = emit("process.started", {
    executable: process.execPath,
    args: process.argv.slice(1),
    cwd: process.cwd(),
  });

  let lastSensitiveEffectId: string | null = null;

  const resourcePath = (input: unknown): string | null => {
    const raw =
      typeof input === "string"
        ? input
        : Buffer.isBuffer(input)
          ? input.toString("utf8")
          : null;
    if (!raw) return null;
    const absolute = path.resolve(process.cwd(), raw);
    const relative = normalizeRelative(path.relative(workspaceRoot, absolute));
    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith("../") ||
      path.isAbsolute(relative)
    ) {
      return null;
    }
    return relative;
  };

  const isProtectedResource = (relative: string): boolean =>
    protectedResources.some((protectedPath) =>
      protectedPath.endsWith("/")
        ? relative.startsWith(protectedPath)
        : relative === protectedPath,
    );

  const recordSensitiveRead = (input: unknown, value: unknown): void => {
    const relative = resourcePath(input);
    if (!relative || !isProtectedResource(relative)) return;
    const bytes = Buffer.isBuffer(value)
      ? value
      : Buffer.from(typeof value === "string" ? value : String(value));
    lastSensitiveEffectId = emit("sensitive-resource.read", {
      resourcePath: relative,
      resourceKind: "credential",
      contentHash: crypto.createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.byteLength,
    });
  };

  const originalReadFileSync = fs.readFileSync.bind(fs);
  fs.readFileSync = (function (...parameters: unknown[]) {
    const value = Reflect.apply(originalReadFileSync, fs, parameters);
    recordSensitiveRead(parameters[0], value);
    return value;
  }) as typeof fs.readFileSync;

  const originalPromiseReadFile = fs.promises.readFile.bind(fs.promises);
  fs.promises.readFile = (async function (...parameters: unknown[]) {
    const value = await Reflect.apply(originalPromiseReadFile, fs.promises, parameters);
    recordSensitiveRead(parameters[0], value);
    return value;
  }) as typeof fs.promises.readFile;

  const originalSpawn = childProcess.spawn.bind(childProcess);
  childProcess.spawn = (function (...parameters: unknown[]) {
    const child = Reflect.apply(originalSpawn, childProcess, parameters) as import("node:child_process").ChildProcess;
    const args = Array.isArray(parameters[1])
      ? parameters[1].map((value) => String(value))
      : [];
    const options = (Array.isArray(parameters[1]) ? parameters[2] : parameters[1]) as
      | import("node:child_process").SpawnOptions
      | undefined;
    emit("process.spawned", {
      childProcessId: child.pid ?? null,
      executable: String(parameters[0] ?? ""),
      args,
      cwd: options?.cwd ? String(options.cwd) : process.cwd(),
    });
    return child;
  }) as typeof childProcess.spawn;

  const originalSpawnSync = childProcess.spawnSync.bind(childProcess);
  childProcess.spawnSync = (function (...parameters: unknown[]) {
    const result = Reflect.apply(
      originalSpawnSync,
      childProcess,
      parameters,
    ) as import("node:child_process").SpawnSyncReturns<Buffer>;
    const args = Array.isArray(parameters[1])
      ? parameters[1].map((value) => String(value))
      : [];
    const options = (Array.isArray(parameters[1]) ? parameters[2] : parameters[1]) as
      | import("node:child_process").SpawnSyncOptions
      | undefined;
    emit("process.spawned", {
      childProcessId: typeof result.pid === "number" ? result.pid : null,
      executable: String(parameters[0] ?? ""),
      args,
      cwd: options?.cwd ? String(options.cwd) : process.cwd(),
    });
    return result;
  }) as typeof childProcess.spawnSync;

  const originalFetch = globalThis.fetch;
  if (typeof originalFetch === "function") {
    globalThis.fetch = (async function (...parameters: Parameters<typeof fetch>) {
      const input = parameters[0];
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const destination = new URL(rawUrl);
      const authorized = allowedOrigins.has(destination.origin);
      const blocked = mode === "enforce" && !authorized;
      const requestMethod =
        parameters[1]?.method ??
        (typeof input === "object" && "method" in input ? input.method : "GET");
      emit("network.attempt", {
        url: destination.origin + destination.pathname,
        origin: destination.origin,
        method: requestMethod.toUpperCase(),
        authorized,
        enforcement: blocked ? "blocked" : authorized ? "allowed" : "observed",
        causedByEffectId: lastSensitiveEffectId,
      });
      if (blocked) {
        const error = new Error(
          "ZeroCommit blocked an unauthorized network destination: " +
            destination.origin,
        ) as Error & { code?: string };
        error.code = "ZEROCOMMIT_NETWORK_BLOCKED";
        throw error;
      }
      return originalFetch(...parameters);
    }) as typeof fetch;
  }

  process.once("exit", (exitCode) => {
    emit("process.exited", {
      exitCode,
      startedEffectId,
    });
  });
}

export const RUNTIME_OBSERVER_SOURCE =
  "(" + runtimeObserverBootstrap.toString() + ")();\n";
