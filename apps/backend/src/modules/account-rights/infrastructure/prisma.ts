import type {
  PlatformPrisma,
  TransactionClient,
} from "../../../infrastructure/prisma/prisma-client.js";

export type AccountRightsPrisma = Pick<
  PlatformPrisma,
  | "$executeRaw"
  | "$queryRaw"
  | "accessGrant"
  | "tariffAssignment"
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
  AccountRightsPrisma,
  | "accessChange"
  | "accessGrant"
  | "legacyClassification"
  | "membershipBinding"
  | "membershipEvidenceReceipt"
  | "membershipProjection"
>;

/** A caller hands these delegates to Membership to finalize a principal in its transaction. */
export type MembershipPrincipalBindingPrisma = Pick<
  AccountRightsPrisma,
  "$executeRaw" | "membershipBinding"
>;

export type AccountRightsPrismaTransaction = AccountRightsPrisma;

export type AccountRightsPrismaClient = AccountRightsPrisma &
  TransactionClient<AccountRightsPrismaTransaction>;

/** Billing hands these delegates to Membership to assign a tariff under the pricing lock. */
export type MembershipEnrollmentPrisma = Pick<
  AccountRightsPrisma,
  | "$executeRaw"
  | "accessReceipt"
  | "tariffAssignment"
  | "sourceEntitlement"
  | "accessGrant"
  | "accessChange"
  | "telegramAccountLinkState"
  | "telegramAccountLinkHistory"
>;

/** Billing hands its transaction to Membership for an enrollment expansion preview. */
export type MembershipEnrollmentPreviewPrisma = Pick<
  AccountRightsPrisma,
  "$executeRaw" | "accessReceipt" | "tariffAssignment" | "accessBatchPreview"
>;

/** Billing hands its transaction to Membership to save an activation rule. */
export type MembershipActivationRulePrisma = Pick<
  AccountRightsPrisma,
  "$executeRaw" | "accessReceipt" | "activationRule"
>;
