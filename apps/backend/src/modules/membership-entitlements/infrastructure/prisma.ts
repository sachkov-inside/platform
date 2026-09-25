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

export type MembershipEntitlementsPrismaTransaction =
  MembershipEntitlementsPrisma;

export type MembershipEntitlementsPrismaClient =
  MembershipEntitlementsPrisma &
    TransactionClient<MembershipEntitlementsPrismaTransaction>;
