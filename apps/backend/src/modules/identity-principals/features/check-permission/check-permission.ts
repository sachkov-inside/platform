import type { IdentityPrincipalsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { parsePrincipalId } from "../../domain/identity-identifiers.js";
import type {
  PermissionDecision,
  PlatformPermission,
} from "../../facets/identity-principals/identity-principals.interface.js";
import { isPlatformPermission } from "../../shared/identity-input.js";
import { internalFailure } from "../../shared/internal-failure.js";

export async function checkPermission(
  prisma: IdentityPrincipalsPrismaClient,
  query: { readonly principalId: string; readonly permission: PlatformPermission },
): Promise<PermissionDecision> {
  const principalId = parsePrincipalId(query.principalId);
  if (principalId === undefined || !isPlatformPermission(query.permission)) {
    return { ok: false, error: { code: "invalid_input" } };
  }

  try {
    const principal = await prisma.identityPrincipal.findUnique({
      where: { id: principalId },
      select: { state: true },
    });
    if (principal === null) {
      return { ok: false, error: { code: "identity_not_found" } };
    }
    if (principal.state === "disabled") {
      return { ok: false, error: { code: "principal_disabled" } };
    }
    const grant = await prisma.principalPermission.findUnique({
      where: {
        principalId_permission: { principalId, permission: query.permission },
      },
      select: { principalId: true },
    });
    return { ok: true, allowed: grant !== null };
  } catch {
    return internalFailure();
  }
}
