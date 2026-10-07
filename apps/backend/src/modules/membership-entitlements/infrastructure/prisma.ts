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
  // Accounts delegate: batch operations hand their transaction to Accounts for identity reads.
  | "account"
  // Telegram owns these reads; Membership hands over its transaction to readBinding.
  | "telegramAccountLinkState"
  | "telegramAccountLinkHistory"
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

/** Billing hands these delegates to Membership to assign a tariff under the pricing lock. */
export type MembershipEnrollmentPrisma = Pick<
  MembershipEntitlementsPrisma,
  | "$executeRaw"
  | "accessReceipt"
  | "subscriptionEnrollment"
  | "sourceEntitlement"
  | "accessGrant"
  | "accessChange"
  | "telegramAccountLinkState"
  | "telegramAccountLinkHistory"
>;

/** Billing hands its transaction to Membership for an enrollment expansion preview. */
export type MembershipEnrollmentPreviewPrisma = Pick<
  MembershipEntitlementsPrisma,
  | "$executeRaw"
  | "accessReceipt"
  | "subscriptionEnrollment"
  | "accessBatchPreview"
>;

/** Billing hands its transaction to Membership to save an activation rule. */
export type MembershipActivationRulePrisma = Pick<
  MembershipEntitlementsPrisma,
  "$executeRaw" | "accessReceipt" | "activationRule"
>;
