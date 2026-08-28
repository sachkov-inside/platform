import type { AccountId } from "../../../accounts/index.js";

export type MembershipAccessState =
  | Readonly<{ kind: "active"; validUntil: string }>
  | Readonly<{
      kind: "required" | "expired" | "stale" | "unavailable";
    }>;

export type MembershipEvidenceSource =
  | "link_time"
  | "member_status_event"
  | "reconciliation";

export interface AcceptMembershipEvidenceCommand {
  /** Trusted human Account selected before the provider adapter crosses this seam. */
  readonly accountId: AccountId;
  /** Stable provider delivery key; checked before durable receipt creation. */
  readonly deliveryId: string;
  readonly source: MembershipEvidenceSource;
  readonly evidence: unknown;
}

export type MembershipEvidenceFailureCode =
  | "unsupported_contract"
  | "invalid_evidence"
  | "principal_mismatch"
  | "expired_evidence"
  | "replayed_evidence"
  | "unavailable";

export type MembershipEvidenceAcceptance =
  | Readonly<{
      ok: true;
      outcome: "applied";
      state: "active" | "non_member";
      evidenceVersion: number;
    }>
  | Readonly<{
      ok: true;
      outcome: "accepted_without_entitlement";
      decision:
        | "identity_not_linked"
        | "identity_conflict"
        | "unavailable";
    }>
  | Readonly<{
      ok: true;
      outcome: "duplicate";
      evidenceVersion: number;
    }>
  | Readonly<{
      ok: false;
      error: { readonly code: MembershipEvidenceFailureCode };
    }>;

export interface MembershipEntitlements {
  resolveForAccess(accountId: AccountId): Promise<MembershipAccessState>;
  /**
   * Applies normalized evidence monotonically. Only link-time observed evidence may establish a
   * missing Account binding; events and reconciliation wait for it, and mismatches fail closed.
   */
  acceptEvidence(
    command: AcceptMembershipEvidenceCommand,
  ): Promise<MembershipEvidenceAcceptance>;
}
