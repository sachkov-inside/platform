import { createHmac } from "node:crypto";

import {
  type IdentityPrincipalsPrisma,
  type IdentityPrincipalsPrismaClient,
  Prisma,
} from "../../../../infrastructure/prisma/index.js";
import { z } from "zod";
import {
  newExternalIdentityId,
  newPlatformSessionId,
  newPrincipalId,
  parseIdentityIdempotencyKey,
} from "../../domain/identity-identifiers.js";
import type {
  HumanSessionEstablishmentResult,
  ServiceSessionEstablishmentResult,
  VerifiedHumanSignIn,
  VerifiedServiceSessionIdentity,
} from "../../facets/identity-principals/identity-principals.interface.js";
import {
  acquireAdvisoryLocks,
} from "../../infrastructure/postgres/advisory-locks.js";
import { appendIdentityAuditEvent } from "../../infrastructure/postgres/identity-audit.js";
import {
  claimIdentityIdempotency,
  completeIdentityIdempotency,
} from "../../infrastructure/postgres/identity-idempotency.js";
import {
  buildSubject,
  loadSubject,
  parsePrincipal,
  type PrincipalRow,
  type SessionRow,
  type SubjectBuildResult,
} from "../../infrastructure/postgres/subject-hydration.js";
import {
  fingerprintCommand,
  validIdentityKey,
  validTimestamp,
} from "../../shared/identity-input.js";
import { internalFailure } from "../../shared/internal-failure.js";
import { platformSessionLifetimeMs } from "../../shared/identity-time-policy.js";

const lockedIdentityRowsSchema = z.array(
  z.object({
    id: z.uuid(),
    kind: z.enum(["human", "service"]),
    state: z.enum(["active", "disabled"]),
  }),
);

export async function establishHumanSession(
  prisma: IdentityPrincipalsPrismaClient,
  emailFingerprintKey: string,
  command: {
    readonly identity: VerifiedHumanSignIn;
    readonly idempotencyKey: string;
  },
): Promise<HumanSessionEstablishmentResult> {
  if (
    !validIdentityKey(command.identity) ||
    !validTimestamp(command.identity.authenticatedAt) ||
    normalizeEmail(command.identity.verifiedEmail) === undefined
  ) {
    return { ok: false, error: { code: "invalid_input" } };
  }
  const idempotencyKey = parseIdentityIdempotencyKey(command.idempotencyKey);
  if (idempotencyKey === undefined) {
    return { ok: false, error: { code: "invalid_input" } };
  }

  const emailFingerprint = fingerprintEmail(
    command.identity.verifiedEmail,
    emailFingerprintKey,
  );
  const requestFingerprint = fingerprintCommand({
    kind: "human",
    issuer: command.identity.issuer,
    subject: command.identity.subject,
    authenticatedAt: command.identity.authenticatedAt,
    emailFingerprint,
  });

  try {
    return await prisma.$transaction(async (transaction) => {
      const replay = await claimIdentityIdempotency(
        transaction,
        "establish_human_session",
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
        return loadSubject(transaction, replay.principalId, replay.sessionId);
      }

      const identityFingerprint = fingerprintCommand({
        issuer: command.identity.issuer,
        subject: command.identity.subject,
      });
      await acquireAdvisoryLocks(transaction, [
        `identity:${identityFingerprint}`,
        `email:${emailFingerprint}`,
      ]);

      const existingIdentity = await transaction.externalIdentity.findUnique({
        where: {
          issuer_subject: {
            issuer: command.identity.issuer,
            subject: command.identity.subject,
          },
        },
        select: { principalId: true, emailFingerprint: true },
      });

      let principal: PrincipalRow;
      if (existingIdentity === null) {
        const emailOwner = await transaction.externalIdentity.findUnique({
          where: { emailFingerprint },
          select: { principalId: true },
        });
        if (emailOwner !== null) {
          await appendIdentityAuditEvent(
            transaction,
            "establish_human_session",
            "identity_conflict_duplicate_email",
            {},
          );
          return { ok: false, error: { code: "identity_conflict" } };
        }

        principal = { id: newPrincipalId(), kind: "human", state: "active" };
        await transaction.identityPrincipal.create({ data: principal });
        await transaction.externalIdentity.create({
          data: {
            id: newExternalIdentityId(),
            principalId: principal.id,
            issuer: command.identity.issuer,
            subject: command.identity.subject,
            emailFingerprint,
          },
        });
      } else {
        const persistedPrincipal = await transaction.identityPrincipal.findUnique({
          where: { id: existingIdentity.principalId },
          select: { id: true, kind: true, state: true },
        });
        if (persistedPrincipal === null) {
          return internalFailure();
        }
        const parsedPrincipal = parsePrincipal(persistedPrincipal);
        if (parsedPrincipal === undefined) {
          return internalFailure();
        }
        principal = parsedPrincipal;
        if (principal.kind !== "human") {
          await appendIdentityAuditEvent(
            transaction,
            "establish_human_session",
            "identity_conflict_principal_kind",
            { principalId: principal.id },
          );
          return { ok: false, error: { code: "identity_conflict" } };
        }
        if (existingIdentity.emailFingerprint !== emailFingerprint) {
          const emailOwner = await transaction.externalIdentity.findUnique({
            where: { emailFingerprint },
            select: { principalId: true },
          });
          if (emailOwner === null || emailOwner.principalId === principal.id) {
            await transaction.externalIdentity.update({
              where: {
                issuer_subject: {
                  issuer: command.identity.issuer,
                  subject: command.identity.subject,
                },
              },
              data: { emailFingerprint },
            });
          } else {
            await appendIdentityAuditEvent(
              transaction,
              "establish_human_session",
              "email_observation_conflict",
              { principalId: principal.id },
            );
          }
        }
      }

      if (principal.state === "disabled") {
        return { ok: false, error: { code: "principal_disabled" } };
      }
      return createSession(
        transaction,
        principal,
        new Date(command.identity.authenticatedAt),
        "establish_human_session",
        idempotencyKey,
      );
    });
  } catch {
    return internalFailure();
  }
}

export async function establishServiceSession(
  prisma: IdentityPrincipalsPrismaClient,
  command: {
    readonly identity: VerifiedServiceSessionIdentity;
    readonly idempotencyKey: string;
  },
): Promise<ServiceSessionEstablishmentResult> {
  const idempotencyKey = parseIdentityIdempotencyKey(command.idempotencyKey);
  if (!validIdentityKey(command.identity) || idempotencyKey === undefined) {
    return { ok: false, error: { code: "invalid_input" } };
  }
  const requestFingerprint = fingerprintCommand({
    kind: "service",
    issuer: command.identity.issuer,
    subject: command.identity.subject,
    authenticatedAt: command.identity.authenticatedAt,
  });

  try {
    return await prisma.$transaction(async (transaction) => {
      const replay = await claimIdentityIdempotency(
        transaction,
        "establish_service_session",
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
        return loadSubject(transaction, replay.principalId, replay.sessionId);
      }

      const rows = lockedIdentityRowsSchema.parse(
        await transaction.$queryRaw(Prisma.sql`
          select principals.id, principals.kind, principals.state
          from identity_principals.external_identities as external_identities
          inner join identity_principals.principals as principals
            on principals.id = external_identities.principal_id
          where external_identities.issuer = ${command.identity.issuer}
            and external_identities.subject = ${command.identity.subject}
          for update of principals
        `),
      );
      const identity = rows[0];
      if (identity === undefined || identity.kind !== "service") {
        return { ok: false, error: { code: "identity_not_found" } };
      }
      const principal = parsePrincipal(identity);
      if (principal === undefined) {
        return internalFailure();
      }
      if (principal.state === "disabled") {
        return { ok: false, error: { code: "principal_disabled" } };
      }
      return createSession(
        transaction,
        principal,
        new Date(command.identity.authenticatedAt),
        "establish_service_session",
        idempotencyKey,
      );
    });
  } catch {
    return internalFailure();
  }
}

async function createSession(
  prisma: IdentityPrincipalsPrisma,
  principal: PrincipalRow,
  authenticatedAt: Date,
  operation: "establish_human_session" | "establish_service_session",
  idempotencyKey: NonNullable<ReturnType<typeof parseIdentityIdempotencyKey>>,
): Promise<SubjectBuildResult> {
  const createdAt = new Date();
  const session: SessionRow = {
    id: newPlatformSessionId(),
    principalId: principal.id,
    authenticatedAt,
    expiresAt: new Date(createdAt.getTime() + platformSessionLifetimeMs),
    endedAt: null,
  };
  await prisma.platformSession.create({
    data: { ...session, createdAt, securityVersion: 1 },
  });
  await completeIdentityIdempotency(
    prisma,
    operation,
    idempotencyKey,
    principal.id,
    session.id,
  );
  await appendIdentityAuditEvent(prisma, operation, "succeeded", {
    principalId: principal.id,
    sessionId: session.id,
  });
  return buildSubject(prisma, principal, session);
}

function fingerprintEmail(email: string, key: string): string {
  const normalized = normalizeEmail(email);
  if (normalized === undefined) {
    throw new TypeError("verified email is invalid");
  }
  return `v1:${createHmac("sha256", key).update(normalized).digest("hex")}`;
}

function normalizeEmail(value: string): string | undefined {
  const normalized = value.normalize("NFC").trim().toLocaleLowerCase("en-US");
  if (normalized.length === 0 || normalized.length > 320 || !normalized.includes("@")) {
    return undefined;
  }
  return normalized;
}
