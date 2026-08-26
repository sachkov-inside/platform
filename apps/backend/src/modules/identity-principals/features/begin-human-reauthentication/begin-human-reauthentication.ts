import {
  type IdentityPrincipalsPrismaClient,
  Prisma,
} from "../../../../infrastructure/prisma/index.js";
import { z } from "zod";
import {
  newReauthenticationAttemptId,
  parseIdentityIdempotencyKey,
  parsePlatformSessionId,
} from "../../domain/identity-identifiers.js";
import type {
  BeginReauthenticationResult,
  VerifiedSessionIdentity,
} from "../../facets/identity-principals/identity-principals.interface.js";
import {
  acquireAdvisoryLocks,
} from "../../infrastructure/postgres/advisory-locks.js";
import { appendIdentityAuditEvent } from "../../infrastructure/postgres/identity-audit.js";
import { activeHumanSessionError } from "../../shared/active-human-session.js";
import {
  fingerprintCommand,
  validIdentityKey,
} from "../../shared/identity-input.js";
import { internalFailure } from "../../shared/internal-failure.js";
import { humanReauthenticationLifetimeMs } from "../../shared/identity-time-policy.js";

const activeSessionRowsSchema = z.array(
  z.object({
    kind: z.enum(["human", "service"]),
    state: z.enum(["active", "disabled"]),
    expiresAt: z.date(),
    endedAt: z.date().nullable(),
  }),
);

export async function beginHumanReauthentication(
  prisma: IdentityPrincipalsPrismaClient,
  command: {
    readonly identity: Extract<VerifiedSessionIdentity, { readonly type: "human_session" }>;
    readonly idempotencyKey: string;
    readonly sessionRef: string;
  },
): Promise<BeginReauthenticationResult> {
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
    sessionRef: sessionId,
  });

  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireAdvisoryLocks(transaction, [`reauth-begin:${idempotencyKey}`]);
      const replay = await transaction.identityReauthenticationAttempt.findUnique({
        where: { beginIdempotencyKey: idempotencyKey },
        select: { id: true, expiresAt: true, beginRequestFingerprint: true },
      });
      if (replay !== null) {
        return replay.beginRequestFingerprint === requestFingerprint
          ? {
              ok: true,
              attemptId: replay.id,
              expiresAt: replay.expiresAt.toISOString(),
            }
          : { ok: false, error: { code: "idempotency_key_reused" } };
      }

      const rows = activeSessionRowsSchema.parse(
        await transaction.$queryRaw(Prisma.sql`
          select
            principals.kind,
            principals.state,
            platform_sessions.expires_at as "expiresAt",
            platform_sessions.ended_at as "endedAt"
          from identity_principals.platform_sessions as platform_sessions
          inner join identity_principals.principals as principals
            on principals.id = platform_sessions.principal_id
          inner join identity_principals.external_identities as external_identities
            on external_identities.principal_id = principals.id
          where platform_sessions.id = ${sessionId}
            and external_identities.issuer = ${command.identity.issuer}
            and external_identities.subject = ${command.identity.subject}
        `),
      );
      const sessionError = activeHumanSessionError(rows[0]);
      if (sessionError !== undefined) {
        return sessionError;
      }

      const createdAt = new Date();
      const attemptId = newReauthenticationAttemptId();
      const expiresAt = new Date(
        createdAt.getTime() + humanReauthenticationLifetimeMs,
      );
      await transaction.identityReauthenticationAttempt.create({
        data: {
          id: attemptId,
          sessionId,
          createdAt,
          expiresAt,
          beginIdempotencyKey: idempotencyKey,
          beginRequestFingerprint: requestFingerprint,
        },
      });
      await appendIdentityAuditEvent(
        transaction,
        "begin_human_reauthentication",
        "succeeded",
        {
          sessionId,
        },
      );
      return { ok: true, attemptId, expiresAt: expiresAt.toISOString() };
    });
  } catch {
    return internalFailure();
  }
}
