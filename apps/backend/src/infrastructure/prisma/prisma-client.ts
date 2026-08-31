import type { PrismaClient } from "./generated/client.js";

export type PlatformPrisma = PrismaClient;
export type MaterialsPrisma = Pick<
  PlatformPrisma,
  | "$executeRaw"
  | "$queryRaw"
  | "authoringIdempotency"
  | "format"
  | "material"
  | "materialRelatedPin"
  | "materialSearchDocument"
  | "materialTag"
  | "publishedMaterial"
  | "publishedMaterialSeriesMembership"
  | "publishedMaterialTag"
  | "series"
  | "seriesMembership"
  | "tag"
  | "topic"
>;
export type MaterialsPrismaTransaction = MaterialsPrisma;
export type MaterialsPrismaClient = MaterialsPrisma &
  TransactionClient<MaterialsPrismaTransaction>;

export type AccountsPrisma = Pick<
  PlatformPrisma,
  "$queryRaw" | "account" | "accountAuditEvent" | "accountPermission"
>;
export type AccountsPrismaClient = AccountsPrisma & TransactionClient<AccountsPrisma>;

export type MemberProfilesPrisma = Pick<
  PlatformPrisma,
  "memberProfile" | "memberProfileAuditEvent" | "memberProfileReport"
>;
export type MemberProfilesPrismaClient = MemberProfilesPrisma &
  TransactionClient<MemberProfilesPrisma>;

export interface TransactionClient<Transaction> {
  $transaction<Result>(
    operation: (transaction: Transaction) => Promise<Result>,
  ): Promise<Result>;
}
