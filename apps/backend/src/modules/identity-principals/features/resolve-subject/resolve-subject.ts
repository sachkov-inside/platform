import {
  type IdentityPrincipalsPrismaClient,
  Prisma,
} from "../../../../infrastructure/prisma/index.js";
import { z } from "zod";
import { parsePlatformSessionId } from "../../domain/identity-identifiers.js";
import type {
  ResolveSubjectResult,
  VerifiedSessionIdentity,
} from "../../facets/identity-principals/identity-principals.interface.js";
import {
  buildSubject,
  parsePrincipal,
  parseSession,
} from "../../infrastructure/postgres/subject-hydration.js";
import { identityKind, validIdentityKey } from "../../shared/identity-input.js";
import { internalFailure } from "../../shared/internal-failure.js";

const resolvedSessionRowsSchema = z.array(
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

export async function resolveSubject(
  prisma: IdentityPrincipalsPrismaClient,
  query: { readonly identity: VerifiedSessionIdentity; readonly sessionRef: string },
): Promise<ResolveSubjectResult> {
  const sessionId = parsePlatformSessionId(query.sessionRef);
  if (!validIdentityKey(query.identity) || sessionId === undefined) {
    return { ok: false, error: { code: "invalid_input" } };
  }

  try {
    const rows = resolvedSessionRowsSchema.parse(
      await prisma.$queryRaw(Prisma.sql`
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
          and external_identities.issuer = ${query.identity.issuer}
          and external_identities.subject = ${query.identity.subject}
      `),
    );
    const row = rows[0];
    if (row === undefined) {
      return { ok: false, error: { code: "session_not_found" } };
    }
    const principal = parsePrincipal(row);
    const session = parseSession({
      id: row.sessionId,
      principalId: row.principalId,
      authenticatedAt: row.authenticatedAt,
      expiresAt: row.expiresAt,
      endedAt: row.endedAt,
    });
    if (principal === undefined || session === undefined) {
      return internalFailure();
    }
    if (principal.state === "disabled") {
      return { ok: false, error: { code: "principal_disabled" } };
    }
    if (session.endedAt !== null) {
      return { ok: false, error: { code: "session_ended" } };
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      return { ok: false, error: { code: "session_expired" } };
    }
    if (principal.kind !== identityKind(query.identity)) {
      return { ok: false, error: { code: "identity_mismatch" } };
    }
    return await buildSubject(prisma, principal, session);
  } catch {
    return internalFailure();
  }
}
