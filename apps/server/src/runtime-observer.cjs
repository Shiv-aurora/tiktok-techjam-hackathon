"use strict";

(() => {
  const fs = require("node:fs");
  const path = require("node:path");
  const crypto = require("node:crypto");
  const childProcess = require("node:child_process");

  const guard = Symbol.for("zerocommit.runtime-observer.loaded");
  if (globalThis[guard]) return;
  globalThis[guard] = true;

  const transactionId = process.env.ZEROCOMMIT_TRANSACTION_ID || "unscoped";
  const effectLogPath = process.env.ZEROCOMMIT_EFFECT_LOG || "";
  const workspaceRoot = path.resolve(
    process.env.ZEROCOMMIT_WORKSPACE_ROOT || process.cwd(),
  );
  const mode = process.env.ZEROCOMMIT_MODE === "enforce" ? "enforce" : "observe";

  function parseStringArray(name) {
    try {
      const parsed = JSON.parse(process.env[name] || "[]");
      return Array.isArray(parsed)
        ? parsed.filter((value) => typeof value === "string")
        : [];
    } catch {
      return [];
    }
  }

  function normalizeRelative(value) {
    return value.replaceAll("\\", "/").replace(/^\.\//, "");
  }

  const protectedResources = parseStringArray(
    "ZEROCOMMIT_PROTECTED_RESOURCES",
  ).map(normalizeRelative);
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

  const sensitiveFlag =
    /^--?(?:api[-_]?key|token|password|secret|authorization|credential|access[-_]?key)(?:=(.*))?$/i;
  const obviousSecret =
    /^(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{12,}|Bearer\s+\S+|AKIA[0-9A-Z]{16})$/;

  function redactArguments(values) {
    let redactNext = false;
    return values.map((value) => {
      if (redactNext) {
        redactNext = false;
        return "<redacted>";
      }

      const flagMatch = value.match(sensitiveFlag);
      if (flagMatch) {
        if (value.includes("=")) {
          return value.slice(0, value.indexOf("=") + 1) + "<redacted>";
        }
        redactNext = true;
        return value;
      }

      if (obviousSecret.test(value)) return "<redacted>";
      if (value.length > 512) return "<redacted:long-argument>";
      try {
        const candidate = new URL(value);
        if (candidate.protocol === "http:" || candidate.protocol === "https:") {
          return candidate.origin + candidate.pathname;
        }
      } catch {
        // Most command arguments are not URLs.
      }
      return value;
    });
  }

  function emit(kind, fields) {
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
      // The control plane treats missing or malformed evidence as a verification failure.
    }
    return id;
  }

  const startedEffectId = emit("process.started", {
    executable: process.execPath,
    args: redactArguments(process.argv.slice(1)),
    cwd: process.cwd(),
  });

  let lastSensitiveEffectId = null;

  function resourcePath(input) {
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
  }

  function isProtectedResource(relative) {
    return protectedResources.some((protectedPath) =>
      protectedPath.endsWith("/")
        ? relative.startsWith(protectedPath)
        : relative === protectedPath,
    );
  }

  function recordSensitiveRead(input, value) {
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
  }

  const originalReadFileSync = fs.readFileSync.bind(fs);
  fs.readFileSync = function (...parameters) {
    const value = Reflect.apply(originalReadFileSync, fs, parameters);
    recordSensitiveRead(parameters[0], value);
    return value;
  };

  const originalPromiseReadFile = fs.promises.readFile.bind(fs.promises);
  fs.promises.readFile = async function (...parameters) {
    const value = await Reflect.apply(originalPromiseReadFile, fs.promises, parameters);
    recordSensitiveRead(parameters[0], value);
    return value;
  };

  const originalSpawn = childProcess.spawn.bind(childProcess);
  childProcess.spawn = function (...parameters) {
    const child = Reflect.apply(originalSpawn, childProcess, parameters);
    const args = Array.isArray(parameters[1])
      ? redactArguments(parameters[1].map((value) => String(value)))
      : [];
    const options = Array.isArray(parameters[1]) ? parameters[2] : parameters[1];
    emit("process.spawned", {
      childProcessId: child.pid || null,
      executable: String(parameters[0] || ""),
      args,
      cwd: options && options.cwd ? String(options.cwd) : process.cwd(),
    });
    return child;
  };

  const originalSpawnSync = childProcess.spawnSync.bind(childProcess);
  childProcess.spawnSync = function (...parameters) {
    const result = Reflect.apply(originalSpawnSync, childProcess, parameters);
    const args = Array.isArray(parameters[1])
      ? redactArguments(parameters[1].map((value) => String(value)))
      : [];
    const options = Array.isArray(parameters[1]) ? parameters[2] : parameters[1];
    emit("process.spawned", {
      childProcessId: typeof result.pid === "number" ? result.pid : null,
      executable: String(parameters[0] || ""),
      args,
      cwd: options && options.cwd ? String(options.cwd) : process.cwd(),
    });
    return result;
  };

  const originalFetch = globalThis.fetch;
  if (typeof originalFetch === "function") {
    globalThis.fetch = async function (...parameters) {
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
        (parameters[1] && parameters[1].method) ||
        (typeof input === "object" && input && "method" in input
          ? input.method
          : "GET");
      emit("network.attempt", {
        url: destination.origin + destination.pathname,
        origin: destination.origin,
        method: String(requestMethod).toUpperCase(),
        authorized,
        enforcement: blocked ? "blocked" : authorized ? "allowed" : "observed",
        causedByEffectId: lastSensitiveEffectId,
      });
      if (blocked) {
        const error = new Error(
          "ZeroCommit blocked an unauthorized network destination: " +
            destination.origin,
        );
        error.code = "ZEROCOMMIT_NETWORK_BLOCKED";
        throw error;
      }
      return originalFetch(...parameters);
    };
  }

  process.once("exit", (exitCode) => {
    emit("process.exited", {
      exitCode,
      startedEffectId,
    });
  });
})();
