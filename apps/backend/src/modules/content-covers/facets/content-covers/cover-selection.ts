import type { TransactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import type { ContentCoverOwner } from "./content-covers.js";

/** Each content owner alone reads and writes its selected cover pointer. */
export interface ContentCoverSelection {
  read(
    owner: ContentCoverOwner,
    transaction: TransactionHandle,
  ): Promise<
    | { readonly coverId: string | null; readonly sourceId: string | null }
    | undefined
  >;
  write(
    owner: ContentCoverOwner,
    coverId: string | null,
    transaction: TransactionHandle,
  ): Promise<void>;
  references(
    owner: ContentCoverOwner,
    coverId: string,
    transaction: TransactionHandle,
  ): Promise<boolean>;
}

export function routeContentCoverSelection(
  selections: Readonly<
    Record<ContentCoverOwner["kind"], ContentCoverSelection>
  >,
): ContentCoverSelection {
  return {
    read: (owner, transaction) =>
      selections[owner.kind].read(owner, transaction),
    write: (owner, coverId, transaction) =>
      selections[owner.kind].write(owner, coverId, transaction),
    references: (owner, coverId, transaction) =>
      selections[owner.kind].references(owner, coverId, transaction),
  };
}
