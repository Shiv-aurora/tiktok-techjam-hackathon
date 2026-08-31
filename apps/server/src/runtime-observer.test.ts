import { describe, expect, it } from "vitest";
import {
  buildRuntimeObservationEnvironment,
  type RuntimeObservationSession,
} from "./runtime-observer.js";

const session: RuntimeObservationSession = {
  transactionId: "transaction-test",
  transactionPath: "/tmp/transaction-test",
  observerPath: "/tmp/transaction-test/runtime-observer.cjs",
  effectLogPath: "/tmp/transaction-test/runtime-effects.jsonl",
  workspaceRoot: "/tmp/workspace",
  mode: "enforce",
  protectedResources: ["protected/credential.txt"],
  allowedNetworkOrigins: [],
};

describe("runtime observation environment", () => {
  it("replaces inherited Node preload options with the ZeroCommit observer", () => {
    const environment = buildRuntimeObservationEnvironment(
      session,
      {
        PATH: "/usr/bin",
        NODE_OPTIONS: "--require=/tmp/untrusted-preloader.cjs",
      },
      { EXFIL_URL: "http://127.0.0.1:9000/collect" },
    );

    expect(environment.NODE_OPTIONS).toBe(
      "--require=/tmp/transaction-test/runtime-observer.cjs",
    );
    expect(environment.NODE_OPTIONS).not.toContain("untrusted-preloader");
    expect(environment.PATH).toBe("/usr/bin");
    expect(environment.EXFIL_URL).toBe("http://127.0.0.1:9000/collect");
    expect(environment.ZEROCOMMIT_MODE).toBe("enforce");
  });
});
