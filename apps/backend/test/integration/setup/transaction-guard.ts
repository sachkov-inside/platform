import { AsyncLocalStorage } from "node:async_hooks";
import { fileURLToPath } from "node:url";

import type { PlatformPrisma } from "../../../src/infrastructure/prisma/index.js";
import { knownTransactionViolations } from "./known-transaction-violations.js";

/**
 * A query on the root client while a transaction of the same asynchronous flow is open. The query
 * asks the pool for a second connection, which `CODING_STANDARDS.md` forbids: as many such
 * operations as the pool has connections hold all of it and wait for each other.
 */
export class SecondConnectionInTransactionError extends Error {
  override readonly name = "SecondConnectionInTransactionError";

  constructor(operation: string) {
    super(
      `${operation} asks the pool for a second connection while a transaction of this operation is open; pass the transaction or move the read before it`,
    );
  }
}

interface OpenTransaction {
  open: boolean;
  /** The issue of a known violation inside this transaction: its further queries pass too. */
  excusedBy?: number | undefined;
}

const openTransaction = new AsyncLocalStorage<OpenTransaction>();

/** Root-client methods that do not ask the pool for a connection of their own. */
const connectionFree = new Set<PropertyKey>([
  "$connect",
  "$disconnect",
  "$on",
  "$extends",
  "then",
]);

export interface GuardedPrisma {
  readonly prisma: PlatformPrisma;
  /**
   * Every refused query so far. A facade that turns a thrown error into a failed result hides the
   * refusal from its caller; the test database reports it from here when it is disposed.
   */
  readonly refused: readonly SecondConnectionInTransactionError[];
}

/**
 * The client checks the rule itself: inside a `$transaction` callback a query through the root
 * client fails with `SecondConnectionInTransactionError` instead of waiting for the pool. Queries
 * through the transaction client the callback receives pass unchanged.
 */
export function guardTransactionConnections(
  prisma: PlatformPrisma,
): GuardedPrisma {
  const refused: SecondConnectionInTransactionError[] = [];
  const refuseInsideTransaction = (operation: string) => {
    const transaction = openTransaction.getStore();
    if (transaction?.open !== true || transaction.excusedBy !== undefined)
      return;
    // The caller that a known violation names can sit deeper than the default ten frames.
    const stackTraceLimit = Error.stackTraceLimit;
    let error: SecondConnectionInTransactionError;
    try {
      Error.stackTraceLimit = 50;
      error = new SecondConnectionInTransactionError(operation);
    } finally {
      Error.stackTraceLimit = stackTraceLimit;
    }
    transaction.excusedBy = knownViolationIn(error.stack);
    if (transaction.excusedBy !== undefined) return;
    refused.push(error);
    throw error;
  };
  const delegates = new Map<PropertyKey, unknown>();
  const guarded = new Proxy(prisma, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (property === "$transaction" && typeof value === "function")
        return (input: unknown, ...rest: unknown[]): unknown => {
          refuseInsideTransaction("$transaction");
          return Reflect.apply(value, target, [
            isCallback(input) ? insideTransaction(input) : input,
            ...rest,
          ]);
        };
      if (typeof property === "symbol" || connectionFree.has(property)) {
        if (typeof value !== "function") return value;
        const bound: unknown = value.bind(target);
        return bound;
      }
      if (isMethod(value))
        return guardCall(property, value, target, refuseInsideTransaction);
      if (typeof value !== "object" || value === null) return value;
      let delegate = delegates.get(property);
      if (delegate === undefined) {
        delegate = guardDelegate(property, value, refuseInsideTransaction);
        delegates.set(property, delegate);
      }
      return delegate;
    },
  });
  return { prisma: guarded, refused };
}

/**
 * Runs `work` as a separate flow, outside the transaction of its caller. For a test that holds a
 * transaction on purpose and inside it starts a concurrent operation that the transaction does not
 * await, such as a contender for the same lock.
 */
export function outsideTransaction<Result>(work: () => Result): Result {
  return openTransaction.exit(work);
}

const backendRoot = fileURLToPath(new URL("../../../", import.meta.url));
const guardFile = fileURLToPath(import.meta.url);

/**
 * A known violation is named by a frame of the transaction callback: the frames between the
 * guard's own frames on top and the guard's callback wrapper. The code that opened the
 * transaction sits below the wrapper and excuses nothing.
 */
function knownViolationIn(stack = ""): number | undefined {
  const frames = stack.split("\n").slice(1);
  const ownFrames = frames.findIndex((frame) => !frame.includes(guardFile));
  const wrapper = frames.findIndex(
    (frame, index) => index > ownFrames && frame.includes(guardFile),
  );
  const callback = frames
    .slice(ownFrames, wrapper === -1 ? undefined : wrapper)
    .join("\n");
  return knownTransactionViolations.find(({ through, callbackName }) =>
    callback
      .split("\n")
      .some(
        (frame) =>
          frame.includes(`${backendRoot}${through}:`) &&
          (callbackName === undefined ||
            frame.includes(`at ${callbackName} (`)),
      ),
  )?.issue;
}

type TransactionCallback = (tx: unknown) => unknown;

function isCallback(input: unknown): input is TransactionCallback {
  return typeof input === "function";
}

/**
 * The callback runs with its transaction marked open, and only until the callback settles. A
 * transaction that a known violation opens inside an excused one is excused as well.
 */
function insideTransaction(callback: TransactionCallback) {
  const outer = openTransaction.getStore();
  const excusedBy = outer?.open === true ? outer.excusedBy : undefined;
  return async (tx: unknown): Promise<unknown> => {
    const transaction: OpenTransaction = { open: true, excusedBy };
    try {
      return await openTransaction.run(transaction, () => callback(tx));
    } finally {
      transaction.open = false;
    }
  };
}

function guardDelegate(
  model: string,
  delegate: object,
  refuseInsideTransaction: (operation: string) => void,
): object {
  return new Proxy(delegate, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (!isMethod(value) || typeof property === "symbol") return value;
      return guardCall(
        `${model}.${property}`,
        value,
        target,
        refuseInsideTransaction,
      );
    },
  });
}

type Method = (...args: unknown[]) => unknown;

function isMethod(value: unknown): value is Method {
  return typeof value === "function";
}

function guardCall(
  operation: string,
  method: Method,
  target: object,
  refuseInsideTransaction: (operation: string) => void,
) {
  return (...args: unknown[]): unknown => {
    refuseInsideTransaction(operation);
    return Reflect.apply(method, target, args);
  };
}
