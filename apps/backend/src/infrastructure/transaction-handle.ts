/** A connection-scoped capability. It exposes no persistence delegates. */
declare const transactionBrand: unique symbol;
export interface TransactionHandle {
  readonly [transactionBrand]: true;
}
