import type { AccountId } from "../../../accounts/index.js";
import type { TransactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";

export type MembershipAccessState =
  | Readonly<{ kind: "active"; validUntil: string | null }>
  | Readonly<{
      kind: "required" | "expired" | "stale" | "unavailable";
    }>;

export interface AccountRights {
  /** Same resource-scoped state as resolveForAccess, for many Accounts in one snapshot. Keys retain requested UUID spelling. */
  resolveForAccessAccounts?(
    accountIds: readonly AccountId[],
    productIds?: readonly string[],
    materialId?: string,
    transaction?: TransactionHandle,
  ): Promise<ReadonlyMap<string, MembershipAccessState>>;
  resolveManyForAccess?(
    accountId: AccountId,
    resources: readonly {
      productIds: readonly string[];
      materialId?: string | undefined;
    }[],
  ): Promise<readonly MembershipAccessState[]>;
  resolveForAccess(
    accountId: AccountId,
    productIds?: readonly string[],
    materialId?: string,
  ): Promise<MembershipAccessState>;
  /**
   * Membership of the whole Account in the caller's transaction, which already holds
   * `lockAccountEntitlementChanges` for it, so the facts that open access cannot change under the
   * reads. The caller's transaction type lists `TransactionHandle` to hand itself over, and no
   * second pooled connection is taken.
   */
  resolveForAccessUnderEntitlementLock(
    transaction: TransactionHandle,
    accountId: AccountId,
  ): Promise<MembershipAccessState>;
}
