import {
  type IdentityPrincipalsPrisma,
  Prisma,
} from "../../../../infrastructure/prisma/index.js";
import { z } from "zod";
import {
  parsePlatformSessionId,
  parsePrincipalId,
  type IdentityIdempotencyKey,
  type PlatformSessionId,
  type PrincipalId,
} from "../../domain/identity-identifiers.js";

type IdempotencyClaim =
  | { readonly kind: "claimed" }
  | { readonly kind: "mismatch" }
  | {
      readonly kind: "complete";
      readonly principalId: PrincipalId;
      readonly sessionId: PlatformSessionId;
    }
  | { readonly kind: "invalid" };

const idempotencyRowsSchema = z.array(
  z.object({
    requestFingerprint: z.string(),
    principalId: z.uuid().nullable(),
    sessionId: z.uuid().nullable(),
  }),
);

export async function claimIdentityIdempotency(
  prisma: IdentityPrincipalsPrisma,
  operation: string,
  idempotencyKey: IdentityIdempotencyKey,
  requestFingerprint: string,
): Promise<IdempotencyClaim> {
  await prisma.identityIdempotency.createMany({
    data: [{ operation, idempotencyKey, requestFingerprint }],
    skipDuplicates: true,
  });
  const rows = idempotencyRowsSchema.parse(
    await prisma.$queryRaw(Prisma.sql`
      select
        request_fingerprint as "requestFingerprint",
        principal_id as "principalId",
        session_id as "sessionId"
      from identity_principals.identity_idempotency
      where operation = ${operation}
        and idempotency_key = ${idempotencyKey}
      for update
    `),
  );
  const row = rows[0];
  if (row === undefined) {
    return { kind: "invalid" };
  }
  if (row.requestFingerprint !== requestFingerprint) {
    return { kind: "mismatch" };
  }
  if (row.principalId !== null && row.sessionId !== null) {
    const principalId = parsePrincipalId(row.principalId);
    const sessionId = parsePlatformSessionId(row.sessionId);
    return principalId === undefined || sessionId === undefined
      ? { kind: "invalid" }
      : { kind: "complete", principalId, sessionId };
  }
  return { kind: "claimed" };
}

export async function completeIdentityIdempotency(
  prisma: IdentityPrincipalsPrisma,
  operation: string,
  idempotencyKey: IdentityIdempotencyKey,
  principalId: PrincipalId,
  sessionId: PlatformSessionId,
): Promise<void> {
  await prisma.identityIdempotency.update({
    where: { operation_idempotencyKey: { operation, idempotencyKey } },
    data: { principalId, sessionId },
  });
}
