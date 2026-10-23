import type { TransactionHandle } from "../transaction-handle.js";
export type { TransactionHandle } from "../transaction-handle.js";

const connections = new WeakMap<TransactionHandle, object>();
const handles = new WeakMap<object, TransactionHandle>();

/** Called by the transaction owner when handing its connection to another state owner. */
export function transactionHandle(connection: object): TransactionHandle {
  const existing = handles.get(connection);
  if (existing !== undefined) return existing;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Only this factory brands runtime-validated opaque capabilities.
  const handle = Object.freeze({}) as TransactionHandle;
  connections.set(handle, connection);
  handles.set(connection, handle);
  return handle;
}

/** Persistence implementations alone may unwrap into their own scoped client. */
export function unwrapTransaction(handle: TransactionHandle): unknown {
  const connection = connections.get(handle);
  if (connection === undefined)
    throw new TypeError("Invalid transaction handle");
  return connection;
}
