import type {
  PlatformPrisma,
  TransactionClient,
} from "../../../infrastructure/prisma/prisma-client.js";

export type MembershipEntitlementsPrisma = Pick<
  PlatformPrisma,
  | "$executeRaw"
  | "$queryRaw"
  | "accessGrant"
  | "subscriptionEnrollment"
  | "activationRule"
  | "activationAttempt"
  | "invitation"
  | "sourceEntitlement"
  | "tributePolicy"
  | "tributeInbox"
  | "tributeImportReview"
  | "accessReceipt"
  | "accessBatchPreview"
  | "accessChange"
  | "legacyClassification"
  | "membershipBinding"
  | "membershipEvidenceReceipt"
  | "membershipProjection"
>;

/** What Membership reads to decide access; a caller's transaction lists these to hand itself over. */
export type MembershipAccessPrisma = Pick<
  MembershipEntitlementsPrisma,
  | "accessChange"
  | "accessGrant"
  | "legacyClassification"
  | "membershipBinding"
  | "membershipEvidenceReceipt"
  | "membershipProjection"
>;

/** A caller hands these delegates to Membership to finalize a principal in its transaction. */
export type MembershipPrincipalBindingPrisma = Pick<
  MembershipEntitlementsPrisma,
  "$executeRaw" | "membershipBinding"
>;

export type MembershipEntitlementsPrismaTransaction =
  MembershipEntitlementsPrisma;

export type MembershipEntitlementsPrismaClient = MembershipEntitlementsPrisma &
  TransactionClient<MembershipEntitlementsPrismaTransaction>;
