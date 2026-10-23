/** A connection-scoped capability. It exposes no persistence delegates. */
declare const transactionBrand: unique symbol;
export interface TransactionHandle {
  readonly [transactionBrand]: true;
}

const connections = new WeakMap<TransactionHandle, object>();
const handles = new WeakMap<object, TransactionHandle>();

/** Called by the transaction owner when handing its connection to another state owner. */
export function transactionHandle(connection: object): TransactionHandle {
  const existing = handles.get(connection);
  if (existing !== undefined) return existing;
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
