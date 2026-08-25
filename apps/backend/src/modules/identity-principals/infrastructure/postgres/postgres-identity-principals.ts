import { createHash, createHmac, randomUUID } from "node:crypto";

import { sql, type Transaction } from "kysely";

import type { DB } from "../../../../infrastructure/postgres/generated/database.js";
import type { PlatformDatabase } from "../../../../infrastructure/postgres/index.js";
import type {
  EndSessionResult,
  HumanSessionEstablishmentResult,
  BeginReauthenticationResult,
  CompleteReauthenticationResult,
  IdentityPrincipals,
  PermissionDecision,
  PlatformPermission,
  ResolveSubjectResult,
  ServiceSessionEstablishmentResult,
  TrustedSubject,
  VerifiedHumanSignIn,
  VerifiedHumanReauthentication,
  VerifiedServiceSessionIdentity,
  VerifiedSessionIdentity,
} from "../../application/identity-principals.interface.js";
import {
  newExternalIdentityId,
  newPlatformSessionId,
  newPrincipalId,
  newReauthenticationAttemptId,
  parsePlatformSessionId,
  parsePrincipalId,
  parseIdentityIdempotencyKey,
  parseReauthenticationAttemptId,
  type IdentityIdempotencyKey,
  type PlatformSessionId,
  type PrincipalId,
} from "../../domain/identity-identifiers.js";

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const REAUTHENTICATION_LIFETIME_MS = 5 * 60 * 1_000;
const permissionValues = new Set<PlatformPermission>([
  "identity:admin",
  "materials:author",
  "materials:publish",
]);

interface Dependencies {
  readonly database: PlatformDatabase;
  readonly emailFingerprintKey: string;
}

interface PrincipalRow {
  readonly id: PrincipalId;
  readonly kind: "human" | "service";
  readonly state: "active" | "disabled";
}

interface SessionRow {
  readonly id: PlatformSessionId;
  readonly principal_id: PrincipalId;
  readonly authenticated_at: Date;
  readonly expires_at: Date;
  readonly ended_at: Date | null;
}

type SubjectBuildResult =
  | { readonly ok: true; readonly subject: TrustedSubject }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "internal_error";
        readonly correlationId: string;
      };
    };

export function createPostgresIdentityPrincipals({
  database,
  emailFingerprintKey,
}: Dependencies): IdentityPrincipals {
  if (emailFingerprintKey.length < 16) {
    throw new TypeError("emailFingerprintKey must contain at least 16 characters");
  }

  const implementation: IdentityPrincipals = {
    establishHumanSession: (command) =>
      establishHumanSession(database, emailFingerprintKey, command),
    establishServiceSession: (command) =>
      establishServiceSession(database, command),
    resolveSubject: (query) => resolveSubject(database, query),
    beginHumanReauthentication: (command) =>
      beginHumanReauthentication(database, command),
    completeHumanReauthentication: (command) =>
      completeHumanReauthentication(database, command),
    endSession: (command) => endSession(database, command),
    checkPermission: (query) => checkPermission(database, query),
  };
  return Object.freeze(implementation);
}

async function establishHumanSession(
  database: PlatformDatabase,
  emailFingerprintKey: string,
  command: {
    readonly identity: VerifiedHumanSignIn;
    readonly idempotencyKey: string;
  },
): Promise<HumanSessionEstablishmentResult> {
  const inputError = validateHumanSignIn(command);
  const idempotencyKey = parseIdentityIdempotencyKey(command.idempotencyKey);
  if (inputError !== undefined || idempotencyKey === undefined) {
    return inputError ?? { ok: false, error: { code: "invalid_input" } };
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
    return await database.transaction().execute(async (transaction) => {
      const replay = await claimIdempotency(
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

      await lockIdentityCreation(
        transaction,
        fingerprintCommand({
          issuer: command.identity.issuer,
          subject: command.identity.subject,
        }),
        emailFingerprint,
      );

      const existingIdentity = await transaction
        .selectFrom("identity_principals.external_identities as external_identities")
        .innerJoin("identity_principals.principals as principals", "principals.id", "external_identities.principal_id")
        .select([
          "principals.id",
          "principals.kind",
          "principals.state",
          "external_identities.email_fingerprint",
        ])
        .where("external_identities.issuer", "=", command.identity.issuer)
        .where("external_identities.subject", "=", command.identity.subject)
        .executeTakeFirst();

      let principal: PrincipalRow;
      if (existingIdentity === undefined) {
        const emailOwner = await transaction
          .selectFrom("identity_principals.external_identities as external_identities")
          .select("principal_id")
          .where("email_fingerprint", "=", emailFingerprint)
          .executeTakeFirst();
        if (emailOwner !== undefined) {
          await appendAudit(
            transaction,
            "establish_human_session",
            "identity_conflict_duplicate_email",
            {},
          );
          return { ok: false, error: { code: "identity_conflict" } };
        }

        principal = { id: newPrincipalId(), kind: "human", state: "active" };
        await transaction.insertInto("identity_principals.principals").values(principal).execute();
        await transaction
          .insertInto("identity_principals.external_identities")
          .values({
            id: newExternalIdentityId(),
            principal_id: principal.id,
            issuer: command.identity.issuer,
            subject: command.identity.subject,
            email_fingerprint: emailFingerprint,
          })
          .execute();
      } else {
        const parsedPrincipal = parsePrincipal(existingIdentity);
        if (parsedPrincipal === undefined) {
          return internalFailure();
        }
        principal = parsedPrincipal;
        if (principal.kind !== "human") {
          await appendAudit(
            transaction,
            "establish_human_session",
            "identity_conflict_principal_kind",
            { principalId: principal.id },
          );
          return { ok: false, error: { code: "identity_conflict" } };
        }
        if (existingIdentity.email_fingerprint !== emailFingerprint) {
          const emailOwner = await transaction
            .selectFrom("identity_principals.external_identities as external_identities")
            .select("principal_id")
            .where("email_fingerprint", "=", emailFingerprint)
            .executeTakeFirst();
          if (emailOwner === undefined || emailOwner.principal_id === principal.id) {
            await transaction
              .updateTable("identity_principals.external_identities")
              .set({ email_fingerprint: emailFingerprint })
              .where("issuer", "=", command.identity.issuer)
              .where("subject", "=", command.identity.subject)
              .execute();
          } else {
            await appendAudit(
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

      const createdAt = new Date();
      const session: SessionRow = {
        id: newPlatformSessionId(),
        principal_id: principal.id,
        authenticated_at: new Date(command.identity.authenticatedAt),
        expires_at: new Date(createdAt.getTime() + SESSION_LIFETIME_MS),
        ended_at: null,
      };
      await transaction
        .insertInto("identity_principals.platform_sessions")
        .values({ ...session, created_at: createdAt, security_version: 1 })
        .execute();
      await completeIdempotency(
        transaction,
        "establish_human_session",
        idempotencyKey,
        principal.id,
        session.id,
      );
      await appendAudit(transaction, "establish_human_session", "succeeded", {
        principalId: principal.id,
        sessionId: session.id,
      });

      return buildSubject(transaction, principal, session);
    });
  } catch {
    return internalFailure();
  }
}

async function establishServiceSession(
  database: PlatformDatabase,
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
    return await database.transaction().execute(async (transaction) => {
      const replay = await claimIdempotency(
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

      const identity = await transaction
        .selectFrom("identity_principals.external_identities as external_identities")
        .innerJoin("identity_principals.principals as principals", "principals.id", "external_identities.principal_id")
        .select(["principals.id", "principals.kind", "principals.state"])
        .where("external_identities.issuer", "=", command.identity.issuer)
        .where("external_identities.subject", "=", command.identity.subject)
        .forUpdate()
        .executeTakeFirst();
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

      const createdAt = new Date();
      const session: SessionRow = {
        id: newPlatformSessionId(),
        principal_id: principal.id,
        authenticated_at: new Date(command.identity.authenticatedAt),
        expires_at: new Date(createdAt.getTime() + SESSION_LIFETIME_MS),
        ended_at: null,
      };
      await transaction
        .insertInto("identity_principals.platform_sessions")
        .values({ ...session, created_at: createdAt, security_version: 1 })
        .execute();
      await completeIdempotency(
        transaction,
        "establish_service_session",
        idempotencyKey,
        principal.id,
        session.id,
      );
      await appendAudit(transaction, "establish_service_session", "succeeded", {
        principalId: principal.id,
        sessionId: session.id,
      });
      return buildSubject(transaction, principal, session);
    });
  } catch {
    return internalFailure();
  }
}

async function resolveSubject(
  database: PlatformDatabase,
  query: { readonly identity: VerifiedSessionIdentity; readonly sessionRef: string },
): Promise<ResolveSubjectResult> {
  const sessionId = parsePlatformSessionId(query.sessionRef);
  if (!validIdentityKey(query.identity) || sessionId === undefined) {
    return { ok: false, error: { code: "invalid_input" } };
  }

  const row = await database
    .selectFrom("identity_principals.platform_sessions as platform_sessions")
    .innerJoin("identity_principals.principals as principals", "principals.id", "platform_sessions.principal_id")
    .innerJoin("identity_principals.external_identities as external_identities", "external_identities.principal_id", "principals.id")
    .select([
      "principals.id",
      "principals.kind",
      "principals.state",
      "platform_sessions.id as session_id",
      "platform_sessions.principal_id",
      "platform_sessions.authenticated_at",
      "platform_sessions.expires_at",
      "platform_sessions.ended_at",
    ])
    .where("platform_sessions.id", "=", sessionId)
    .where("external_identities.issuer", "=", query.identity.issuer)
    .where("external_identities.subject", "=", query.identity.subject)
    .executeTakeFirst();
  if (row === undefined) {
    return { ok: false, error: { code: "session_not_found" } };
  }
  const principal = parsePrincipal(row);
  if (principal === undefined) {
    return internalFailure();
  }
  if (row.state === "disabled") {
    return { ok: false, error: { code: "principal_disabled" } };
  }
  if (row.ended_at !== null) {
    return { ok: false, error: { code: "session_ended" } };
  }
  if (row.expires_at.getTime() <= Date.now()) {
    return { ok: false, error: { code: "session_expired" } };
  }
  if (row.kind !== identityKind(query.identity)) {
    return { ok: false, error: { code: "identity_mismatch" } };
  }
  const session = parseSession({
    id: row.session_id,
    principal_id: row.principal_id,
    authenticated_at: row.authenticated_at,
    expires_at: row.expires_at,
    ended_at: row.ended_at,
  });
  return session === undefined
    ? internalFailure()
    : buildSubject(database, principal, session);
}

async function endSession(
  database: PlatformDatabase,
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
    return await database.transaction().execute(async (transaction) => {
      const replay = await claimIdempotency(
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

      const owned = await transaction
        .selectFrom("identity_principals.platform_sessions as platform_sessions")
        .innerJoin("identity_principals.principals as principals", "principals.id", "platform_sessions.principal_id")
        .innerJoin(
          "identity_principals.external_identities as external_identities",
          "external_identities.principal_id",
          "platform_sessions.principal_id",
        )
        .select(["platform_sessions.id", "platform_sessions.principal_id", "principals.kind"])
        .where("platform_sessions.id", "=", sessionId)
        .where("external_identities.issuer", "=", command.identity.issuer)
        .where("external_identities.subject", "=", command.identity.subject)
        .forUpdate()
        .executeTakeFirst();
      if (owned === undefined) {
        return { ok: false, error: { code: "session_not_found" } };
      }
      if (owned.kind !== identityKind(command.identity)) {
        return { ok: false, error: { code: "identity_mismatch" } };
      }
      const principalId = parsePrincipalId(owned.principal_id);
      const ownedSessionId = parsePlatformSessionId(owned.id);
      if (principalId === undefined || ownedSessionId === undefined) {
        return internalFailure();
      }

      await transaction
        .updateTable("identity_principals.platform_sessions")
        .set({ ended_at: new Date() })
        .where("id", "=", sessionId)
        .where("ended_at", "is", null)
        .execute();
      await completeIdempotency(
        transaction,
        "end_session",
        idempotencyKey,
        principalId,
        ownedSessionId,
      );
      await appendAudit(transaction, "end_session", "succeeded", {
        principalId,
        sessionId: ownedSessionId,
      });
      return { ok: true, ended: true };
    });
  } catch {
    return internalFailure();
  }
}

async function beginHumanReauthentication(
  database: PlatformDatabase,
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
    return await database.transaction().execute(async (transaction) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`reauth-begin:${idempotencyKey}`}, 0::bigint))`.execute(
      transaction,
    );
    const replay = await transaction
      .selectFrom("identity_principals.identity_reauthentication_attempts")
      .select(["id", "expires_at", "begin_request_fingerprint"])
      .where("begin_idempotency_key", "=", idempotencyKey)
      .executeTakeFirst();
    if (replay !== undefined) {
      return replay.begin_request_fingerprint === requestFingerprint
        ? { ok: true, attemptId: replay.id, expiresAt: replay.expires_at.toISOString() }
        : { ok: false, error: { code: "idempotency_key_reused" } };
    }

    const owned = await transaction
      .selectFrom("identity_principals.platform_sessions as platform_sessions")
      .innerJoin("identity_principals.principals as principals", "principals.id", "platform_sessions.principal_id")
      .innerJoin(
        "identity_principals.external_identities as external_identities",
        "external_identities.principal_id",
        "principals.id",
      )
      .select([
        "principals.kind",
        "principals.state",
        "platform_sessions.expires_at",
        "platform_sessions.ended_at",
      ])
      .where("platform_sessions.id", "=", sessionId)
      .where("external_identities.issuer", "=", command.identity.issuer)
      .where("external_identities.subject", "=", command.identity.subject)
      .executeTakeFirst();
    const sessionError = activeHumanSessionError(owned);
    if (sessionError !== undefined) {
      return sessionError;
    }

    const createdAt = new Date();
    const attemptId = newReauthenticationAttemptId();
    const expiresAt = new Date(createdAt.getTime() + REAUTHENTICATION_LIFETIME_MS);
    await transaction
      .insertInto("identity_principals.identity_reauthentication_attempts")
      .values({
        id: attemptId,
        session_id: sessionId,
        created_at: createdAt,
        expires_at: expiresAt,
        consumed_at: null,
        token_fingerprint: null,
        begin_idempotency_key: idempotencyKey,
        begin_request_fingerprint: requestFingerprint,
        complete_idempotency_key: null,
        complete_request_fingerprint: null,
      })
      .execute();
    await appendAudit(transaction, "begin_human_reauthentication", "succeeded", {
      sessionId,
    });
    return { ok: true, attemptId, expiresAt: expiresAt.toISOString() };
    });
  } catch {
    return internalFailure();
  }
}

async function completeHumanReauthentication(
  database: PlatformDatabase,
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
    return await database.transaction().execute(async (transaction) => {
    const replay = await claimIdempotency(
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

    const attempt = await transaction
      .selectFrom("identity_principals.identity_reauthentication_attempts")
      .selectAll()
      .where("id", "=", attemptId)
      .forUpdate()
      .executeTakeFirst();
    if (attempt === undefined || attempt.session_id !== sessionId) {
      return { ok: false, error: { code: "reauthentication_required" } };
    }

    const owned = await transaction
      .selectFrom("identity_principals.platform_sessions as platform_sessions")
      .innerJoin("identity_principals.principals as principals", "principals.id", "platform_sessions.principal_id")
      .innerJoin(
        "identity_principals.external_identities as external_identities",
        "external_identities.principal_id",
        "principals.id",
      )
      .select([
        "principals.id",
        "principals.kind",
        "principals.state",
        "platform_sessions.id as session_id",
        "platform_sessions.principal_id",
        "platform_sessions.authenticated_at",
        "platform_sessions.expires_at",
        "platform_sessions.ended_at",
      ])
      .where("platform_sessions.id", "=", sessionId)
      .where("external_identities.issuer", "=", command.proof.issuer)
      .where("external_identities.subject", "=", command.proof.subject)
      .executeTakeFirst();
    if (owned === undefined) {
      return { ok: false, error: { code: "identity_mismatch" } };
    }
    const sessionError = activeHumanSessionError(owned);
    if (sessionError !== undefined) {
      return sessionError;
    }
    const principal = parsePrincipal(owned);
    const ownedSession = parseSession({
      id: owned.session_id,
      principal_id: owned.principal_id,
      authenticated_at: owned.authenticated_at,
      expires_at: owned.expires_at,
      ended_at: owned.ended_at,
    });
    if (principal === undefined || ownedSession === undefined) {
      return internalFailure();
    }

    if (attempt.consumed_at !== null) {
      if (
        attempt.complete_idempotency_key === idempotencyKey &&
        attempt.complete_request_fingerprint === completionFingerprint
      ) {
        return buildSubject(transaction, principal, ownedSession);
      }
      return attempt.complete_idempotency_key === idempotencyKey
        ? { ok: false, error: { code: "idempotency_key_reused" } }
        : { ok: false, error: { code: "reauthentication_required" } };
    }

    const now = new Date();
    const reauthenticatedAt = new Date(command.proof.reauthenticatedAt);
    if (
      attempt.expires_at.getTime() <= now.getTime() ||
      reauthenticatedAt.getTime() > now.getTime() + 30_000 ||
      now.getTime() - reauthenticatedAt.getTime() > REAUTHENTICATION_LIFETIME_MS ||
      reauthenticatedAt.getTime() <= owned.authenticated_at.getTime() ||
      reauthenticatedAt.getTime() < attempt.created_at.getTime()
    ) {
      return { ok: false, error: { code: "reauthentication_required" } };
    }
    const usedToken = await transaction
      .selectFrom("identity_principals.identity_reauthentication_attempts")
      .select("id")
      .where("token_fingerprint", "=", tokenFingerprint)
      .executeTakeFirst();
    if (usedToken !== undefined) {
      return { ok: false, error: { code: "reauthentication_required" } };
    }

    await transaction
      .updateTable("identity_principals.platform_sessions")
      .set({
        authenticated_at: reauthenticatedAt,
        security_version: (expression) => expression("security_version", "+", 1),
      })
      .where("id", "=", sessionId)
      .execute();
    await transaction
      .updateTable("identity_principals.identity_reauthentication_attempts")
      .set({
        consumed_at: now,
        token_fingerprint: tokenFingerprint,
        complete_idempotency_key: idempotencyKey,
        complete_request_fingerprint: completionFingerprint,
      })
      .where("id", "=", attempt.id)
      .execute();
    await completeIdempotency(
      transaction,
      "complete_human_reauthentication",
      idempotencyKey,
      principal.id,
      ownedSession.id,
    );

    await appendAudit(transaction, "complete_human_reauthentication", "succeeded", {
      principalId: principal.id,
      sessionId: ownedSession.id,
    });

    return buildSubject(transaction, principal, {
      ...ownedSession,
      authenticated_at: reauthenticatedAt,
    });
    });
  } catch {
    return internalFailure();
  }
}

async function checkPermission(
  database: PlatformDatabase,
  query: { readonly principalId: string; readonly permission: PlatformPermission },
): Promise<PermissionDecision> {
  const principalId = parsePrincipalId(query.principalId);
  if (principalId === undefined || !permissionValues.has(query.permission)) {
    return { ok: false, error: { code: "invalid_input" } };
  }
  const principal = await database
    .selectFrom("identity_principals.principals as principals")
    .select("state")
    .where("id", "=", principalId)
    .executeTakeFirst();
  if (principal === undefined) {
    return { ok: false, error: { code: "identity_not_found" } };
  }
  if (principal.state === "disabled") {
    return { ok: false, error: { code: "principal_disabled" } };
  }
  const grant = await database
    .selectFrom("identity_principals.principal_permissions")
    .select("principal_id")
    .where("principal_id", "=", principalId)
    .where("permission", "=", query.permission)
    .executeTakeFirst();
  return { ok: true, allowed: grant !== undefined };
}

async function buildSubject(
  database: PlatformDatabase | Transaction<DB>,
  principal: PrincipalRow,
  session: SessionRow,
): Promise<SubjectBuildResult> {
  const permissions = await database
    .selectFrom("identity_principals.principal_permissions")
    .select("permission")
    .where("principal_id", "=", principal.id)
    .orderBy("permission")
    .execute();
  const parsedPermissions = permissions.map(({ permission }) =>
    parsePermission(permission),
  );
  if (parsedPermissions.some((permission) => permission === undefined)) {
    return internalFailure();
  }
  const subject: TrustedSubject = {
    principalId: principal.id,
    principalKind: principal.kind,
    sessionRef: session.id,
    authenticatedAt: session.authenticated_at.toISOString(),
    expiresAt: session.expires_at.toISOString(),
    permissions: parsedPermissions.filter(
      (permission): permission is PlatformPermission => permission !== undefined,
    ),
  };
  return { ok: true, subject };
}

async function loadSubject(
  transaction: Transaction<DB>,
  principalId: PrincipalId,
  sessionId: PlatformSessionId,
): Promise<SubjectBuildResult> {
  const principal = await transaction
    .selectFrom("identity_principals.principals as principals")
    .select(["id", "kind", "state"])
    .where("id", "=", principalId)
    .executeTakeFirst();
  const session = await transaction
    .selectFrom("identity_principals.platform_sessions as platform_sessions")
    .select(["id", "principal_id", "authenticated_at", "expires_at", "ended_at"])
    .where("id", "=", sessionId)
    .executeTakeFirst();
  if (principal === undefined || session === undefined) {
    return internalFailure();
  }
  const parsedPrincipal = parsePrincipal(principal);
  const parsedSession = parseSession(session);
  if (parsedPrincipal === undefined || parsedSession === undefined) {
    return internalFailure();
  }
  return buildSubject(transaction, parsedPrincipal, parsedSession);
}

type IdempotencyClaim =
  | { readonly kind: "claimed" }
  | { readonly kind: "mismatch" }
  | {
      readonly kind: "complete";
      readonly principalId: PrincipalId;
      readonly sessionId: PlatformSessionId;
    }
  | { readonly kind: "invalid" };

async function claimIdempotency(
  transaction: Transaction<DB>,
  operation: string,
  idempotencyKey: IdentityIdempotencyKey,
  requestFingerprint: string,
): Promise<IdempotencyClaim> {
  await transaction
    .insertInto("identity_principals.identity_idempotency")
    .values({
      operation,
      idempotency_key: idempotencyKey,
      request_fingerprint: requestFingerprint,
      principal_id: null,
      session_id: null,
    })
    .onConflict((conflict) => conflict.columns(["operation", "idempotency_key"]).doNothing())
    .execute();
  const row = await transaction
    .selectFrom("identity_principals.identity_idempotency")
    .select(["request_fingerprint", "principal_id", "session_id"])
    .where("operation", "=", operation)
    .where("idempotency_key", "=", idempotencyKey)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (row.request_fingerprint !== requestFingerprint) {
    return { kind: "mismatch" };
  }
  if (row.principal_id !== null && row.session_id !== null) {
    const principalId = parsePrincipalId(row.principal_id);
    const sessionId = parsePlatformSessionId(row.session_id);
    return principalId === undefined || sessionId === undefined
      ? { kind: "invalid" }
      : { kind: "complete", principalId, sessionId };
  }
  return { kind: "claimed" };
}

async function completeIdempotency(
  transaction: Transaction<DB>,
  operation: string,
  idempotencyKey: IdentityIdempotencyKey,
  principalId: PrincipalId,
  sessionId: PlatformSessionId,
): Promise<void> {
  await transaction
    .updateTable("identity_principals.identity_idempotency")
    .set({ principal_id: principalId, session_id: sessionId })
    .where("operation", "=", operation)
    .where("idempotency_key", "=", idempotencyKey)
    .execute();
}

async function appendAudit(
  transaction: Transaction<DB>,
  operation: string,
  outcome: string,
  references: {
    readonly principalId?: PrincipalId;
    readonly sessionId?: PlatformSessionId;
  },
): Promise<void> {
  await transaction
    .insertInto("identity_principals.identity_audit_events")
    .values({
      id: randomUUID(),
      operation,
      outcome,
      principal_id: references.principalId ?? null,
      session_id: references.sessionId ?? null,
    })
    .execute();
}

async function lockIdentityCreation(
  transaction: Transaction<DB>,
  identityKey: string,
  emailFingerprint: string,
): Promise<void> {
  const lockKeys = [`email:${emailFingerprint}`, `identity:${identityKey}`].sort();
  for (const lockKey of lockKeys) {
    await sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0::bigint))`.execute(
      transaction,
    );
  }
}

function validateHumanSignIn(command: {
  readonly identity: VerifiedHumanSignIn;
  readonly idempotencyKey: string;
}): HumanSessionEstablishmentResult | undefined {
  if (
    !validIdentityKey(command.identity) ||
    !validTimestamp(command.identity.authenticatedAt) ||
    normalizeEmail(command.identity.verifiedEmail) === undefined
  ) {
    return { ok: false, error: { code: "invalid_input" } };
  }
  return undefined;
}

function validIdentityKey(identity: { readonly issuer: string; readonly subject: string }): boolean {
  try {
    const issuer = new URL(identity.issuer);
    return (
      issuer.protocol === "https:" &&
      issuer.toString() === identity.issuer &&
      identity.subject.length > 0 &&
      identity.subject.length <= 500
    );
  } catch {
    return false;
  }
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function normalizeEmail(value: string): string | undefined {
  const normalized = value.normalize("NFC").trim().toLocaleLowerCase("en-US");
  if (normalized.length === 0 || normalized.length > 320 || !normalized.includes("@")) {
    return undefined;
  }
  return normalized;
}

function fingerprintEmail(email: string, key: string): string {
  const normalized = normalizeEmail(email);
  if (normalized === undefined) {
    throw new TypeError("verified email is invalid");
  }
  return `v1:${createHmac("sha256", key).update(normalized).digest("hex")}`;
}

function fingerprintCommand(value: object): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function identityKind(identity: VerifiedSessionIdentity): "human" | "service" {
  return identity.type === "human_session" ? "human" : "service";
}

function parsePermission(value: string): PlatformPermission | undefined {
  switch (value) {
    case "identity:admin":
    case "materials:author":
    case "materials:publish":
      return value;
    default:
      return undefined;
  }
}

function activeHumanSessionError(value: {
  readonly kind: string;
  readonly state: string;
  readonly expires_at: Date;
  readonly ended_at: Date | null;
} | undefined):
  | {
      readonly ok: false;
      readonly error: {
        readonly code:
          | "principal_disabled"
          | "session_ended"
          | "session_expired"
          | "session_not_found";
      };
    }
  | undefined {
  if (value === undefined || value.kind !== "human") {
    return { ok: false, error: { code: "session_not_found" } };
  }
  if (value.state === "disabled") {
    return { ok: false, error: { code: "principal_disabled" } };
  }
  if (value.ended_at !== null) {
    return { ok: false, error: { code: "session_ended" } };
  }
  if (value.expires_at.getTime() <= Date.now()) {
    return { ok: false, error: { code: "session_expired" } };
  }
  return undefined;
}

function parsePrincipal(value: {
  readonly id: string;
  readonly kind: string;
  readonly state: string;
}): PrincipalRow | undefined {
  const id = parsePrincipalId(value.id);
  if (
    id === undefined ||
    (value.kind !== "human" && value.kind !== "service") ||
    (value.state !== "active" && value.state !== "disabled")
  ) {
    return undefined;
  }
  return { id, kind: value.kind, state: value.state };
}

function parseSession(value: {
  readonly id: string;
  readonly principal_id: string;
  readonly authenticated_at: Date;
  readonly expires_at: Date;
  readonly ended_at: Date | null;
}): SessionRow | undefined {
  const id = parsePlatformSessionId(value.id);
  const principalId = parsePrincipalId(value.principal_id);
  return id === undefined || principalId === undefined
    ? undefined
    : { ...value, id, principal_id: principalId };
}

function internalFailure(): {
  readonly ok: false;
  readonly error: { readonly code: "internal_error"; readonly correlationId: string };
} {
  return {
    ok: false,
    error: { code: "internal_error", correlationId: randomUUID() },
  };
}
