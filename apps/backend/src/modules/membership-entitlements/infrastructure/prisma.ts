import type {
  PlatformPrisma,
  TransactionClient,
} from "../../../infrastructure/prisma/prisma-client.js";

export type MembershipEntitlementsPrisma = Pick<
  PlatformPrisma,
  | "$executeRaw"
  | "$queryRaw"
  | "membershipBinding"
  | "membershipEvidenceReceipt"
  | "membershipProjection"
>;

export type MembershipEntitlementsPrismaTransaction =
  MembershipEntitlementsPrisma;

export type MembershipEntitlementsPrismaClient =
  MembershipEntitlementsPrisma &
    TransactionClient<MembershipEntitlementsPrismaTransaction>;
