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
  readonly accountId: AccountId;
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
  acceptEvidence(
    command: AcceptMembershipEvidenceCommand,
  ): Promise<MembershipEvidenceAcceptance>;
}
