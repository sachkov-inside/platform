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

export type AssetsPrisma = Pick<
  PlatformPrisma,
  | "$executeRaw"
  | "$queryRaw"
  | "materialAsset"
  | "materialAssetVariant"
>;
export type AssetsPrismaTransaction = AssetsPrisma;
export type AssetsPrismaClient = AssetsPrisma &
  TransactionClient<AssetsPrismaTransaction>;

export type AccountsPrisma = Pick<
  PlatformPrisma,
  "$queryRaw" | "account" | "accountAuditEvent" | "accountPermission"
>;
export type AccountsPrismaClient = AccountsPrisma & TransactionClient<AccountsPrisma>;

export type MemberProfilesPrisma = Pick<
  PlatformPrisma,
  "memberProfile" | "memberProfileAuditEvent"
>;
export type MemberProfilesPrismaClient = MemberProfilesPrisma &
  TransactionClient<MemberProfilesPrisma>;

export type TelegramMembershipPrisma = Pick<
  PlatformPrisma,
  "telegramLinkTransaction"
>;
export type TelegramMembershipPrismaClient = TelegramMembershipPrisma &
  TransactionClient<TelegramMembershipPrisma>;

export interface TransactionClient<Transaction> {
  $transaction<Result>(
    operation: (transaction: Transaction) => Promise<Result>,
  ): Promise<Result>;
}
