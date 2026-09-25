import type {
  PlatformPrisma,
  TransactionClient,
} from "../../../infrastructure/prisma/prisma-client.js";

export type WorkshopPrisma = Pick<
  PlatformPrisma,
  | "$executeRaw"
  // Membership delegates: a grant hands its transaction to Membership Entitlements.
  | "accessChange"
  | "accessGrant"
  | "legacyClassification"
  | "membershipBinding"
  | "membershipEvidenceReceipt"
  | "membershipProjection"
  | "workshopCase"
  | "workshopCaseMaterial"
  | "workshopCaseVersion"
  | "workshopEntitlement"
  | "workshopHintReveal"
  | "workshopSolutionReveal"
>;
export type WorkshopPrismaTransaction = WorkshopPrisma;
export type WorkshopPrismaClient = WorkshopPrisma &
  TransactionClient<WorkshopPrismaTransaction>;

export type WorkshopEntitlementsPrisma = Pick<
  PlatformPrisma,
  "workshopMembershipEntitlementProjection"
>;
