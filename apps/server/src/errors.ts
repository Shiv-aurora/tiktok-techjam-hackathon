import type { TransactionViolation } from "./types.js";

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class RunCancelledError extends Error {
  constructor() {
    super("Run cancelled");
    this.name = "RunCancelledError";
  }
}

export class TransactionAbortedError extends Error {
  constructor(
    message: string,
    public readonly violations: TransactionViolation[],
  ) {
    super("ZeroCommit aborted transaction: " + message);
    this.name = "TransactionAbortedError";
  }
}
