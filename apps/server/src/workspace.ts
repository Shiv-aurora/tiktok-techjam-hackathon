import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  Agent,
  AgentTransaction,
  FilesystemEffect,
  FilesystemObjectType,
} from "./types.js";

const TRANSACTION_DIRECTORY = ".zerocommit";
const TRANSACTION_JOURNAL = "journal.json";

interface WorkspaceEntry {
  path: string;
  objectType: FilesystemObjectType;
  hash: string;
  mode: number;
  linkCount: number;
  linkTarget: string | null;
  symlinkAbsolute: boolean;
  symlinkEscapesWorkspace: boolean;
}

interface TransactionJournal {
  version: 1;
  transactionId: string;
  agentId: string;
}

export interface PreparedTransactionWorkspace {
  transactionId: string;
  agentId: string;
  transactionPath: string;
  realWorkspacePath: string;
  shadowWorkspacePath: string;
  backupWorkspacePath: string;
  baseline: Map<string, WorkspaceEntry>;
  baselineHash: string;
}

export interface TransactionInspection {
  effects: FilesystemEffect[];
  baselineHash: string;
  shadowHash: string;
  realHashBeforeDecision: string;
  protectedStateChanged: boolean;
}

export interface TransactionRecoveryResult {
  transactionId: string;
  action: "finalized-commit" | "rolled-back" | "failed";
  finalRealHash: string | null;
  error: string | null;
}

export class WorkspaceIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceIsolationError";
  }
}

const normalizedRelativePath = (relativePath: string): string =>
  relativePath.split(path.sep).join("/");

const isWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(".." + path.sep) && !path.isAbsolute(relative));
};

const exists = async (target: string): Promise<boolean> => {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};

const hashText = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const hashFile = async (filePath: string): Promise<string> => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
};

const manifestHash = (manifest: Map<string, WorkspaceEntry>): string => {
  const canonical = [...manifest.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry) => ({
      path: entry.path,
      objectType: entry.objectType,
      hash: entry.hash,
      mode: entry.mode,
      linkCount: entry.linkCount,
      linkTarget: entry.linkTarget,
      symlinkAbsolute: entry.symlinkAbsolute,
      symlinkEscapesWorkspace: entry.symlinkEscapesWorkspace,
    }));
  return hashText(JSON.stringify(canonical));
};

const isProtectedPath = (relativePath: string): boolean =>
  relativePath === "AGENTS.md" ||
  relativePath === TRANSACTION_DIRECTORY ||
  relativePath.startsWith(TRANSACTION_DIRECTORY + "/");

async function scanWorkspace(root: string): Promise<Map<string, WorkspaceEntry>> {
  const manifest = new Map<string, WorkspaceEntry>();

  const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? path.join(relativeDirectory, entry.name)
        : entry.name;
      const normalizedPath = normalizedRelativePath(relativePath);
      const fullPath = path.join(root, relativePath);
      const stats = await lstat(fullPath);

      if (stats.isDirectory()) {
        manifest.set(normalizedPath, {
          path: normalizedPath,
          objectType: "directory",
          hash: hashText("directory"),
          mode: stats.mode & 0o7777,
          linkCount: 1,
          linkTarget: null,
          symlinkAbsolute: false,
          symlinkEscapesWorkspace: false,
        });
        await visit(fullPath, relativePath);
        continue;
      }

      if (stats.isFile()) {
        manifest.set(normalizedPath, {
          path: normalizedPath,
          objectType: "file",
          hash: await hashFile(fullPath),
          mode: stats.mode & 0o7777,
          linkCount: stats.nlink,
          linkTarget: null,
          symlinkAbsolute: false,
          symlinkEscapesWorkspace: false,
        });
        continue;
      }

      if (stats.isSymbolicLink()) {
        const linkTarget = await readlink(fullPath);
        const resolvedTarget = path.resolve(path.dirname(fullPath), linkTarget);
        manifest.set(normalizedPath, {
          path: normalizedPath,
          objectType: "symlink",
          hash: hashText("symlink:" + linkTarget),
          mode: stats.mode & 0o7777,
          linkCount: 1,
          linkTarget,
          symlinkAbsolute: path.isAbsolute(linkTarget),
          symlinkEscapesWorkspace: !isWithin(root, resolvedTarget),
        });
        continue;
      }

      manifest.set(normalizedPath, {
        path: normalizedPath,
        objectType: "special",
        hash: hashText("special:" + stats.mode),
        mode: stats.mode & 0o7777,
        linkCount: stats.nlink,
        linkTarget: null,
        symlinkAbsolute: false,
        symlinkEscapesWorkspace: false,
      });
    }
  };

  await visit(root, "");
  return manifest;
}

async function cloneWorkspaceSafely(sourceRoot: string, destinationRoot: string): Promise<void> {
  await mkdir(destinationRoot, { recursive: false, mode: 0o700 });

  const visit = async (sourceDirectory: string, destinationDirectory: string): Promise<void> => {
    const entries = await readdir(sourceDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const sourcePath = path.join(sourceDirectory, entry.name);
      const destinationPath = path.join(destinationDirectory, entry.name);
      const stats = await lstat(sourcePath);

      if (stats.isDirectory()) {
        await mkdir(destinationPath, { mode: 0o700 });
        await visit(sourcePath, destinationPath);
        await chmod(destinationPath, stats.mode & 0o7777);
        continue;
      }

      if (stats.isFile()) {
        if (stats.nlink > 1) {
          throw new WorkspaceIsolationError(
            "Existing workspace contains a hard-linked file: " +
              normalizedRelativePath(path.relative(sourceRoot, sourcePath)),
          );
        }
        try {
          await copyFile(sourcePath, destinationPath, constants.COPYFILE_FICLONE);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (!code || !["EINVAL", "ENOSYS", "ENOTSUP", "EXDEV"].includes(code)) {
            throw error;
          }
          await copyFile(sourcePath, destinationPath);
        }
        await chmod(destinationPath, stats.mode & 0o7777);
        continue;
      }

      if (stats.isSymbolicLink()) {
        const linkTarget = await readlink(sourcePath);
        if (path.isAbsolute(linkTarget)) {
          throw new WorkspaceIsolationError(
            "Existing workspace contains an absolute symlink: " +
              normalizedRelativePath(path.relative(sourceRoot, sourcePath)),
          );
        }
        const resolvedTarget = path.resolve(path.dirname(sourcePath), linkTarget);
        if (!isWithin(sourceRoot, resolvedTarget)) {
          throw new WorkspaceIsolationError(
            "Existing workspace symlink escapes the protected workspace: " +
              normalizedRelativePath(path.relative(sourceRoot, sourcePath)),
          );
        }
        await symlink(linkTarget, destinationPath);
        continue;
      }

      throw new WorkspaceIsolationError(
        "Unsupported special file in protected workspace: " +
          normalizedRelativePath(path.relative(sourceRoot, sourcePath)),
      );
    }
  };

  await visit(sourceRoot, destinationRoot);
}

function diffManifests(
  transactionId: string,
  baseline: Map<string, WorkspaceEntry>,
  shadow: Map<string, WorkspaceEntry>,
): FilesystemEffect[] {
  const recordedAt = new Date().toISOString();
  const paths = new Set([...baseline.keys(), ...shadow.keys()]);
  const effects: FilesystemEffect[] = [];

  for (const relativePath of [...paths].sort((left, right) => left.localeCompare(right))) {
    const before = baseline.get(relativePath);
    const after = shadow.get(relativePath);
    if (
      before &&
      after &&
      before.objectType === after.objectType &&
      before.hash === after.hash &&
      before.mode === after.mode &&
      before.linkCount === after.linkCount &&
      before.linkTarget === after.linkTarget &&
      before.symlinkAbsolute === after.symlinkAbsolute &&
      before.symlinkEscapesWorkspace === after.symlinkEscapesWorkspace
    ) {
      continue;
    }

    effects.push({
      id: randomUUID(),
      transactionId,
      category: "filesystem",
      operation: before ? (after ? "modify" : "delete") : "create",
      path: relativePath,
      objectType: after?.objectType ?? before?.objectType ?? "special",
      beforeHash: before?.hash ?? null,
      afterHash: after?.hash ?? null,
      beforeMode: before?.mode ?? null,
      afterMode: after?.mode ?? null,
      beforeLinkCount: before?.linkCount ?? null,
      afterLinkCount: after?.linkCount ?? null,
      beforeLinkTarget: before?.linkTarget ?? null,
      afterLinkTarget: after?.linkTarget ?? null,
      symlinkAbsolute:
        after?.symlinkAbsolute ?? before?.symlinkAbsolute ?? false,
      symlinkEscapesWorkspace:
        after?.symlinkEscapesWorkspace ?? before?.symlinkEscapesWorkspace ?? false,
      protected: isProtectedPath(relativePath),
      recordedAt,
    });
  }

  return effects;
}

export class WorkspaceManager {
  private readonly transactionRoot: string;

  constructor(private readonly root: string) {
    this.transactionRoot = path.join(this.root, TRANSACTION_DIRECTORY, "transactions");
  }

  workspacePath(agentId: string): string {
    return path.join(this.root, agentId);
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await mkdir(path.join(this.root, ".deleted"), { recursive: true });
    await mkdir(this.transactionRoot, { recursive: true, mode: 0o700 });
  }

  async create(agent: Agent): Promise<void> {
    await mkdir(agent.workspacePath, { recursive: false });
    await this.writeInstructions(agent);
    await writeFile(
      path.join(agent.workspacePath, ".gitignore"),
      [".codex/", "node_modules/", "dist/", ".env", "*.log", ""].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(agent.workspacePath, "README.md"),
      [
        "# " + agent.name + " workspace",
        "",
        "Files created or edited by the Agent live here.",
        "The platform-generated AGENTS.md contains the current Agent instructions.",
        "",
      ].join("\n"),
      "utf8",
    );
  }

  async writeInstructions(agent: Agent): Promise<void> {
    const content = [
      "# Platform-managed Agent instructions",
      "",
      "You are the coding Agent named " + agent.name + ".",
      agent.description ? "Purpose: " + agent.description : "",
      "",
      "## Instructions",
      "",
      agent.instructions ||
        "Help the user complete coding tasks in this workspace. Explain material results concisely.",
      "",
      "## Workspace rules",
      "",
      "- Work only inside this workspace unless the user explicitly requests otherwise.",
      "- Preserve existing user files and avoid destructive operations.",
      "- Build and test changes when practical.",
      "- Never print environment variables or credentials.",
      "",
      "This file is regenerated when the Agent configuration is updated.",
      "",
    ]
      .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
      .join("\n");
    await writeFile(path.join(agent.workspacePath, "AGENTS.md"), content, "utf8");
  }

  async archive(agent: Agent): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const destination = path.join(
      this.root,
      ".deleted",
      agent.id + "-" + timestamp,
    );
    await rename(agent.workspacePath, destination);
    return destination;
  }

  async prepareTransaction(
    transactionId: string,
    agent: Agent,
  ): Promise<PreparedTransactionWorkspace> {
    const realWorkspacePath = this.assertAgentWorkspace(agent);
    const transactionPath = path.join(this.transactionRoot, transactionId);
    const shadowWorkspacePath = path.join(transactionPath, "shadow");
    const backupWorkspacePath = path.join(transactionPath, "backup");
    const baseline = await scanWorkspace(realWorkspacePath);
    const baselineHash = manifestHash(baseline);

    await rm(transactionPath, { recursive: true, force: true });
    await mkdir(transactionPath, { recursive: false, mode: 0o700 });
    const journal: TransactionJournal = {
      version: 1,
      transactionId,
      agentId: agent.id,
    };
    await writeFile(
      path.join(transactionPath, TRANSACTION_JOURNAL),
      JSON.stringify(journal, null, 2) + "\n",
      { encoding: "utf8", mode: 0o600 },
    );

    try {
      await cloneWorkspaceSafely(realWorkspacePath, shadowWorkspacePath);
      const clonedHash = manifestHash(await scanWorkspace(shadowWorkspacePath));
      if (clonedHash !== baselineHash) {
        throw new WorkspaceIsolationError(
          "Shadow workspace does not match the protected baseline",
        );
      }
    } catch (error) {
      await rm(transactionPath, { recursive: true, force: true });
      throw error;
    }

    return {
      transactionId,
      agentId: agent.id,
      transactionPath,
      realWorkspacePath,
      shadowWorkspacePath,
      backupWorkspacePath,
      baseline,
      baselineHash,
    };
  }

  async inspectTransaction(
    workspace: PreparedTransactionWorkspace,
  ): Promise<TransactionInspection> {
    const shadow = await scanWorkspace(workspace.shadowWorkspacePath);
    const real = await scanWorkspace(workspace.realWorkspacePath);
    const shadowHash = manifestHash(shadow);
    const realHashBeforeDecision = manifestHash(real);
    return {
      effects: diffManifests(workspace.transactionId, workspace.baseline, shadow),
      baselineHash: workspace.baselineHash,
      shadowHash,
      realHashBeforeDecision,
      protectedStateChanged: realHashBeforeDecision !== workspace.baselineHash,
    };
  }

  async promoteTransaction(
    workspace: PreparedTransactionWorkspace,
    expectedShadowHash: string,
  ): Promise<string> {
    if (await exists(workspace.backupWorkspacePath)) {
      throw new WorkspaceIsolationError("Transaction backup already exists");
    }
    const currentRealHash = await this.hashWorkspace(workspace.realWorkspacePath);
    if (currentRealHash !== workspace.baselineHash) {
      throw new WorkspaceIsolationError(
        "Protected workspace changed after verification and before commit",
      );
    }
    const currentShadowHash = await this.hashWorkspace(workspace.shadowWorkspacePath);
    if (currentShadowHash !== expectedShadowHash) {
      throw new WorkspaceIsolationError(
        "Shadow workspace changed after verification and before commit",
      );
    }
    await rename(workspace.realWorkspacePath, workspace.backupWorkspacePath);
    try {
      await rename(workspace.shadowWorkspacePath, workspace.realWorkspacePath);
    } catch (error) {
      await rename(workspace.backupWorkspacePath, workspace.realWorkspacePath);
      throw error;
    }
    const finalRealHash = await this.hashWorkspace(workspace.realWorkspacePath);
    if (finalRealHash !== expectedShadowHash) {
      throw new WorkspaceIsolationError(
        "Committed workspace does not match the verified shadow state",
      );
    }
    return finalRealHash;
  }

  async abortTransaction(workspace: PreparedTransactionWorkspace): Promise<string> {
    if (await exists(workspace.backupWorkspacePath)) {
      if (await exists(workspace.realWorkspacePath)) {
        await rm(workspace.realWorkspacePath, { recursive: true, force: true });
      }
      await rename(workspace.backupWorkspacePath, workspace.realWorkspacePath);
    }
    await rm(workspace.transactionPath, { recursive: true, force: true });
    return this.hashWorkspace(workspace.realWorkspacePath);
  }

  async finalizeCommittedTransaction(
    workspace: PreparedTransactionWorkspace,
  ): Promise<string> {
    const finalRealHash = await this.hashWorkspace(workspace.realWorkspacePath);
    await rm(workspace.backupWorkspacePath, { recursive: true, force: true });
    await rm(workspace.transactionPath, { recursive: true, force: true });
    return finalRealHash;
  }

  async recoverTransactions(
    transactions: AgentTransaction[],
  ): Promise<TransactionRecoveryResult[]> {
    const knownTransactions = new Map(
      transactions.map((transaction) => [transaction.id, transaction]),
    );
    const entries = await readdir(this.transactionRoot, { withFileTypes: true });
    const results: TransactionRecoveryResult[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const transactionPath = path.join(this.transactionRoot, entry.name);
      try {
        const journal = JSON.parse(
          await readFile(path.join(transactionPath, TRANSACTION_JOURNAL), "utf8"),
        ) as TransactionJournal;
        if (
          journal.version !== 1 ||
          journal.transactionId !== entry.name ||
          !journal.agentId
        ) {
          throw new WorkspaceIsolationError("Invalid transaction recovery journal");
        }
        const transaction = knownTransactions.get(journal.transactionId);
        if (transaction && transaction.agentId !== journal.agentId) {
          throw new WorkspaceIsolationError("Transaction journal agent mismatch");
        }
        const workspace = this.recoveryWorkspace(journal);
        if (transaction?.status === "committed") {
          results.push({
            transactionId: journal.transactionId,
            action: "finalized-commit",
            finalRealHash: await this.finalizeCommittedTransaction(workspace),
            error: null,
          });
        } else {
          results.push({
            transactionId: journal.transactionId,
            action: "rolled-back",
            finalRealHash: await this.abortTransaction(workspace),
            error: null,
          });
        }
      } catch (error) {
        results.push({
          transactionId: entry.name,
          action: "failed",
          finalRealHash: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  async hashWorkspace(workspacePath: string): Promise<string> {
    return manifestHash(await scanWorkspace(workspacePath));
  }

  private assertAgentWorkspace(agent: Agent): string {
    const expected = path.resolve(this.workspacePath(agent.id));
    const actual = path.resolve(agent.workspacePath);
    if (actual !== expected) {
      throw new WorkspaceIsolationError("Agent workspace path is outside the managed root");
    }
    return actual;
  }

  private recoveryWorkspace(journal: TransactionJournal): PreparedTransactionWorkspace {
    const transactionPath = path.join(this.transactionRoot, journal.transactionId);
    return {
      transactionId: journal.transactionId,
      agentId: journal.agentId,
      transactionPath,
      realWorkspacePath: this.workspacePath(journal.agentId),
      shadowWorkspacePath: path.join(transactionPath, "shadow"),
      backupWorkspacePath: path.join(transactionPath, "backup"),
      baseline: new Map(),
      baselineHash: "",
    };
  }
}
