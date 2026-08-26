import {
  type IdentityPrincipalsPrismaClient,
  Prisma,
} from "../../../../infrastructure/prisma/index.js";
import { z } from "zod";
import {
  parseIdentityIdempotencyKey,
  parsePlatformSessionId,
  parseReauthenticationAttemptId,
} from "../../domain/identity-identifiers.js";
import type {
  CompleteReauthenticationResult,
  VerifiedHumanReauthentication,
} from "../../facets/identity-principals/identity-principals.interface.js";
import {
  claimIdentityIdempotency,
  completeIdentityIdempotency,
} from "../../infrastructure/postgres/identity-idempotency.js";
import { appendIdentityAuditEvent } from "../../infrastructure/postgres/identity-audit.js";
import {
  buildSubject,
  loadSubject,
  parsePrincipal,
  parseSession,
} from "../../infrastructure/postgres/subject-hydration.js";
import { activeHumanSessionError } from "../../shared/active-human-session.js";
import {
  fingerprintCommand,
  validIdentityKey,
  validTimestamp,
} from "../../shared/identity-input.js";
import { internalFailure } from "../../shared/internal-failure.js";
import {
  humanReauthenticationLifetimeMs,
  maximumFutureReauthenticationSkewMs,
} from "../../shared/identity-time-policy.js";

const lockedAttemptRowsSchema = z.array(
  z.object({
    id: z.uuid(),
    sessionId: z.uuid(),
    createdAt: z.date(),
    expiresAt: z.date(),
    consumedAt: z.date().nullable(),
    completeIdempotencyKey: z.string().nullable(),
    completeRequestFingerprint: z.string().nullable(),
  }),
);

const ownedSessionRowsSchema = z.array(
  z.object({
    id: z.uuid(),
    kind: z.enum(["human", "service"]),
    state: z.enum(["active", "disabled"]),
    sessionId: z.uuid(),
    principalId: z.uuid(),
    authenticatedAt: z.date(),
    expiresAt: z.date(),
    endedAt: z.date().nullable(),
  }),
);

export async function completeHumanReauthentication(
  prisma: IdentityPrincipalsPrismaClient,
  command: {
    readonly proof: VerifiedHumanReauthentication;
    readonly idempotencyKey: string;
    readonly sessionRef: string;
  },
): Promise<CompleteReauthenticationResult> {
  const idempotencyKey = parseIdentityIdempotencyKey(command.idempotencyKey);
  const sessionId = parsePlatformSessionId(command.sessionRef);
  const attemptId = parseReauthenticationAttemptId(command.proof.attemptId);
  if (
    !validIdentityKey(command.proof) ||
    idempotencyKey === undefined ||
    sessionId === undefined ||
    attemptId === undefined ||
    !validTimestamp(command.proof.reauthenticatedAt) ||
    command.proof.tokenId.length === 0 ||
    command.proof.tokenId.length > 500
  ) {
    return { ok: false, error: { code: "invalid_input" } };
  }
  const completionFingerprint = fingerprintCommand({
    issuer: command.proof.issuer,
    subject: command.proof.subject,
    sessionRef: sessionId,
    attemptId,
    tokenId: command.proof.tokenId,
    reauthenticatedAt: command.proof.reauthenticatedAt,
  });
  const tokenFingerprint = fingerprintCommand({ tokenId: command.proof.tokenId });

  try {
    return await prisma.$transaction(async (transaction) => {
      const replay = await claimIdentityIdempotency(
        transaction,
        "complete_human_reauthentication",
        idempotencyKey,
        completionFingerprint,
      );
      if (replay.kind === "mismatch") {
        return { ok: false, error: { code: "idempotency_key_reused" } };
      }
      if (replay.kind === "invalid") {
        return internalFailure();
      }
      if (replay.kind === "complete") {
        return loadSubject(transaction, replay.principalId, replay.sessionId);
      }

      const attemptRows = lockedAttemptRowsSchema.parse(
        await transaction.$queryRaw(Prisma.sql`
          select
            id,
            session_id as "sessionId",
            created_at as "createdAt",
            expires_at as "expiresAt",
            consumed_at as "consumedAt",
            complete_idempotency_key as "completeIdempotencyKey",
            complete_request_fingerprint as "completeRequestFingerprint"
          from identity_principals.identity_reauthentication_attempts
          where id = ${attemptId}
          for update
        `),
      );
      const attempt = attemptRows[0];
      if (attempt === undefined || attempt.sessionId !== sessionId) {
        return { ok: false, error: { code: "reauthentication_required" } };
      }

      const ownedRows = ownedSessionRowsSchema.parse(
        await transaction.$queryRaw(Prisma.sql`
          select
            principals.id,
            principals.kind,
            principals.state,
            platform_sessions.id as "sessionId",
            platform_sessions.principal_id as "principalId",
            platform_sessions.authenticated_at as "authenticatedAt",
            platform_sessions.expires_at as "expiresAt",
            platform_sessions.ended_at as "endedAt"
          from identity_principals.platform_sessions as platform_sessions
          inner join identity_principals.principals as principals
            on principals.id = platform_sessions.principal_id
          inner join identity_principals.external_identities as external_identities
            on external_identities.principal_id = principals.id
          where platform_sessions.id = ${sessionId}
            and external_identities.issuer = ${command.proof.issuer}
            and external_identities.subject = ${command.proof.subject}
        `),
      );
      const owned = ownedRows[0];
      if (owned === undefined) {
        return { ok: false, error: { code: "identity_mismatch" } };
      }
      const sessionError = activeHumanSessionError(owned);
      if (sessionError !== undefined) {
        return sessionError;
      }
      const principal = parsePrincipal(owned);
      const session = parseSession({
        id: owned.sessionId,
        principalId: owned.principalId,
        authenticatedAt: owned.authenticatedAt,
        expiresAt: owned.expiresAt,
        endedAt: owned.endedAt,
      });
      if (principal === undefined || session === undefined) {
        return internalFailure();
      }

      if (attempt.consumedAt !== null) {
        if (
          attempt.completeIdempotencyKey === idempotencyKey &&
          attempt.completeRequestFingerprint === completionFingerprint
        ) {
          return buildSubject(transaction, principal, session);
        }
        return attempt.completeIdempotencyKey === idempotencyKey
          ? { ok: false, error: { code: "idempotency_key_reused" } }
          : { ok: false, error: { code: "reauthentication_required" } };
      }

      const now = new Date();
      const reauthenticatedAt = new Date(command.proof.reauthenticatedAt);
      if (
        attempt.expiresAt.getTime() <= now.getTime() ||
        reauthenticatedAt.getTime() >
          now.getTime() + maximumFutureReauthenticationSkewMs ||
        now.getTime() - reauthenticatedAt.getTime() >
          humanReauthenticationLifetimeMs ||
        reauthenticatedAt.getTime() <= session.authenticatedAt.getTime() ||
        reauthenticatedAt.getTime() < attempt.createdAt.getTime()
      ) {
        return { ok: false, error: { code: "reauthentication_required" } };
      }
      const usedToken = await transaction.identityReauthenticationAttempt.findUnique({
        where: { tokenFingerprint },
        select: { id: true },
      });
      if (usedToken !== null) {
        return { ok: false, error: { code: "reauthentication_required" } };
      }

      await transaction.platformSession.update({
        where: { id: sessionId },
        data: {
          authenticatedAt: reauthenticatedAt,
          securityVersion: { increment: 1 },
        },
      });
      await transaction.identityReauthenticationAttempt.update({
        where: { id: attempt.id },
        data: {
          consumedAt: now,
          tokenFingerprint,
          completeIdempotencyKey: idempotencyKey,
          completeRequestFingerprint: completionFingerprint,
        },
      });
      await completeIdentityIdempotency(
        transaction,
        "complete_human_reauthentication",
        idempotencyKey,
        principal.id,
        session.id,
      );
      await appendIdentityAuditEvent(
        transaction,
        "complete_human_reauthentication",
        "succeeded",
        {
          principalId: principal.id,
          sessionId: session.id,
        },
      );
      return buildSubject(transaction, principal, {
        ...session,
        authenticatedAt: reauthenticatedAt,
      });
    });
  } catch {
    return internalFailure();
  }
}
