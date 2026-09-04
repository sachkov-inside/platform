import type { AccountId } from "../../../accounts/index.js";

export type WorkshopEntitlementState =
  | Readonly<{ kind: "active"; validUntil: string }>
  | Readonly<{ kind: "required" | "expired" | "stale" | "unavailable" }>;

export interface AcceptedMembershipEvidence {
  readonly accountId: AccountId;
  readonly principalRef: string;
  readonly decision: "member" | "not_member";
  readonly evidenceRef: string;
  readonly evidenceVersion: number;
  readonly evidenceFingerprint: string;
  readonly checkedAt: Date;
  readonly validUntil: Date;
  readonly acceptedAt: Date;
}

export interface WorkshopEntitlementTransaction {
  $executeRaw(query: unknown): Promise<number>;
  $queryRaw(query: unknown): Promise<unknown>;
}

export interface WorkshopEntitlements {
  /** Applies the accepted evidence inside the caller's evidence transaction. */
  applyAcceptedMembershipEvidence(
    transaction: WorkshopEntitlementTransaction,
    evidence: AcceptedMembershipEvidence,
  ): Promise<void>;
  resolveForAccess(accountId: AccountId): Promise<WorkshopEntitlementState>;
}
