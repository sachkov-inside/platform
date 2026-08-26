import type { PrismaClient } from "./generated/client.js";

export type PlatformPrisma = PrismaClient;
export type MaterialsPrisma = Pick<
  PlatformPrisma,
  | "$queryRaw"
  | "authoringIdempotency"
  | "format"
  | "material"
  | "materialAccessAuditEvent"
  | "materialPublicationEvent"
  | "materialRevision"
  | "materialRevisionSeriesMembership"
  | "materialRevisionTag"
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

export type IdentityPrincipalsPrisma = Pick<
  PlatformPrisma,
  | "$queryRaw"
  | "externalIdentity"
  | "identityAuditEvent"
  | "identityIdempotency"
  | "identityPrincipal"
  | "identityReauthenticationAttempt"
  | "platformSession"
  | "principalPermission"
>;
export type IdentityPrincipalsPrismaClient = IdentityPrincipalsPrisma &
  TransactionClient<IdentityPrincipalsPrisma>;

interface TransactionClient<Transaction> {
  $transaction<Result>(
    operation: (transaction: Transaction) => Promise<Result>,
  ): Promise<Result>;
}
