import {
  type IdentityPrincipalsPrismaClient,
  Prisma,
} from "../../../../infrastructure/prisma/index.js";
import { z } from "zod";
import {
  parseIdentityIdempotencyKey,
  parsePlatformSessionId,
  parsePrincipalId,
} from "../../domain/identity-identifiers.js";
import type {
  EndSessionResult,
  VerifiedSessionIdentity,
} from "../../facets/identity-principals/identity-principals.interface.js";
import {
  claimIdentityIdempotency,
  completeIdentityIdempotency,
} from "../../infrastructure/postgres/identity-idempotency.js";
import { appendIdentityAuditEvent } from "../../infrastructure/postgres/identity-audit.js";
import {
  fingerprintCommand,
  identityKind,
  validIdentityKey,
} from "../../shared/identity-input.js";
import { internalFailure } from "../../shared/internal-failure.js";

const ownedSessionRowsSchema = z.array(
  z.object({
    id: z.uuid(),
    principalId: z.uuid(),
    kind: z.enum(["human", "service"]),
  }),
);

export async function endSession(
  prisma: IdentityPrincipalsPrismaClient,
  command: {
    readonly identity: VerifiedSessionIdentity;
    readonly idempotencyKey: string;
    readonly sessionRef: string;
  },
): Promise<EndSessionResult> {
  const idempotencyKey = parseIdentityIdempotencyKey(command.idempotencyKey);
  const sessionId = parsePlatformSessionId(command.sessionRef);
  if (
    !validIdentityKey(command.identity) ||
    idempotencyKey === undefined ||
    sessionId === undefined
  ) {
    return { ok: false, error: { code: "invalid_input" } };
  }
  const requestFingerprint = fingerprintCommand({
    issuer: command.identity.issuer,
    subject: command.identity.subject,
    identityType: command.identity.type,
    sessionRef: sessionId,
  });

  try {
    return await prisma.$transaction(async (transaction) => {
      const replay = await claimIdentityIdempotency(
        transaction,
        "end_session",
        idempotencyKey,
        requestFingerprint,
      );
      if (replay.kind === "mismatch") {
        return { ok: false, error: { code: "idempotency_key_reused" } };
      }
      if (replay.kind === "invalid") {
        return internalFailure();
      }
      if (replay.kind === "complete") {
        return { ok: true, ended: true };
      }

      const rows = ownedSessionRowsSchema.parse(
        await transaction.$queryRaw(Prisma.sql`
          select
            platform_sessions.id,
            platform_sessions.principal_id as "principalId",
            principals.kind
          from identity_principals.platform_sessions as platform_sessions
          inner join identity_principals.principals as principals
            on principals.id = platform_sessions.principal_id
          inner join identity_principals.external_identities as external_identities
            on external_identities.principal_id = platform_sessions.principal_id
          where platform_sessions.id = ${sessionId}
            and external_identities.issuer = ${command.identity.issuer}
            and external_identities.subject = ${command.identity.subject}
          for update of platform_sessions
        `),
      );
      const owned = rows[0];
      if (owned === undefined) {
        return { ok: false, error: { code: "session_not_found" } };
      }
      if (owned.kind !== identityKind(command.identity)) {
        return { ok: false, error: { code: "identity_mismatch" } };
      }
      const principalId = parsePrincipalId(owned.principalId);
      const ownedSessionId = parsePlatformSessionId(owned.id);
      if (principalId === undefined || ownedSessionId === undefined) {
        return internalFailure();
      }

      await transaction.platformSession.updateMany({
        where: { id: sessionId, endedAt: null },
        data: { endedAt: new Date() },
      });
      await completeIdentityIdempotency(
        transaction,
        "end_session",
        idempotencyKey,
        principalId,
        ownedSessionId,
      );
      await appendIdentityAuditEvent(transaction, "end_session", "succeeded", {
        principalId,
        sessionId: ownedSessionId,
      });
      return { ok: true, ended: true };
    });
  } catch {
    return internalFailure();
  }
}
