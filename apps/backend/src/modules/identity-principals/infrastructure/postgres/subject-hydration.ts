import type { IdentityPrincipalsPrisma } from "../../../../infrastructure/prisma/index.js";
import {
  parsePlatformSessionId,
  parsePrincipalId,
  type PlatformSessionId,
  type PrincipalId,
} from "../../domain/identity-identifiers.js";
import type { TrustedSubject } from "../../facets/identity-principals/identity-principals.interface.js";
import { internalFailure } from "../../shared/internal-failure.js";
import { isPlatformPermission } from "../../shared/identity-input.js";

export interface PrincipalRow {
  readonly id: PrincipalId;
  readonly kind: "human" | "service";
  readonly state: "active" | "disabled";
}

export interface SessionRow {
  readonly id: PlatformSessionId;
  readonly principalId: PrincipalId;
  readonly authenticatedAt: Date;
  readonly expiresAt: Date;
  readonly endedAt: Date | null;
}

export type SubjectBuildResult =
  | { readonly ok: true; readonly subject: TrustedSubject }
  | ReturnType<typeof internalFailure>;

export async function buildSubject(
  prisma: IdentityPrincipalsPrisma,
  principal: PrincipalRow,
  session: SessionRow,
): Promise<SubjectBuildResult> {
  const permissionRows = await prisma.principalPermission.findMany({
    where: { principalId: principal.id },
    select: { permission: true },
    orderBy: { permission: "asc" },
  });
  const permissions = permissionRows.map(({ permission }) => permission);
  if (!permissions.every(isPlatformPermission)) {
    return internalFailure();
  }
  return {
    ok: true,
    subject: {
      principalId: principal.id,
      principalKind: principal.kind,
      sessionRef: session.id,
      authenticatedAt: session.authenticatedAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      permissions,
    },
  };
}

export async function loadSubject(
  prisma: IdentityPrincipalsPrisma,
  principalId: PrincipalId,
  sessionId: PlatformSessionId,
): Promise<SubjectBuildResult> {
  const [principalValue, sessionValue] = await Promise.all([
    prisma.identityPrincipal.findUnique({
      where: { id: principalId },
      select: { id: true, kind: true, state: true },
    }),
    prisma.platformSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        principalId: true,
        authenticatedAt: true,
        expiresAt: true,
        endedAt: true,
      },
    }),
  ]);
  if (principalValue === null || sessionValue === null) {
    return internalFailure();
  }
  const principal = parsePrincipal(principalValue);
  const session = parseSession(sessionValue);
  return principal === undefined || session === undefined
    ? internalFailure()
    : buildSubject(prisma, principal, session);
}

export function parsePrincipal(value: {
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

export function parseSession(value: {
  readonly id: string;
  readonly principalId: string;
  readonly authenticatedAt: Date;
  readonly expiresAt: Date;
  readonly endedAt: Date | null;
}): SessionRow | undefined {
  const id = parsePlatformSessionId(value.id);
  const principalId = parsePrincipalId(value.principalId);
  return id === undefined || principalId === undefined
    ? undefined
    : { ...value, id, principalId };
}
