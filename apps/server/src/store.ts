import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentRun, Database } from "./types.js";

interface LegacyRun extends Omit<AgentRun, "transactionId"> {}

interface LegacyDatabaseV1 {
  version: 1;
  agents: Database["agents"];
  messages: Database["messages"];
  runs: LegacyRun[];
}

const emptyDatabase = (): Database => ({
  version: 2,
  agents: [],
  messages: [],
  runs: [],
  transactions: [],
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function parseDatabase(raw: string): { database: Database; migrated: boolean } {
  const parsed: unknown = JSON.parse(raw);
  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed.agents) ||
    !Array.isArray(parsed.messages) ||
    !Array.isArray(parsed.runs)
  ) {
    throw new Error("Unsupported database format");
  }

  if (parsed.version === 2 && Array.isArray(parsed.transactions)) {
    return { database: parsed as unknown as Database, migrated: false };
  }

  if (parsed.version === 1) {
    const legacy = parsed as unknown as LegacyDatabaseV1;
    return {
      database: {
        version: 2,
        agents: legacy.agents,
        messages: legacy.messages,
        runs: legacy.runs.map((run) => ({ ...run, transactionId: null })),
        transactions: [],
      },
      migrated: true,
    };
  }

  throw new Error("Unsupported database format");
}

export class JsonStore {
  private data: Database = emptyDatabase();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      const { database, migrated } = parseDatabase(raw);
      this.data = database;
      if (migrated) await this.persist(database);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      await this.persist();
    }
  }

  snapshot(): Database {
    return structuredClone(this.data);
  }

  async mutate<T>(mutation: (database: Database) => T | Promise<T>): Promise<T> {
    let result!: T;
    const operation = this.queue.then(async () => {
      const next = structuredClone(this.data);
      result = await mutation(next);
      await this.persist(next);
      this.data = next;
    });
    this.queue = operation.catch(() => undefined);
    await operation;
    return result;
  }

  private async persist(data: Database = this.data): Promise<void> {
    const temporaryPath = this.filePath + ".tmp";
    await writeFile(temporaryPath, JSON.stringify(data, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }
}
