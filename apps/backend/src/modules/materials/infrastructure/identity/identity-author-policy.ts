import type { IdentityPrincipals, PlatformPermission } from "../../../identity-principals/index.js";
import type { AuthorPolicy } from "../../application/ports/author-policy.js";

type PermissionChecker = Pick<IdentityPrincipals, "checkPermission">;

export function createIdentityAuthorPolicy(identity: PermissionChecker): AuthorPolicy {
  const implementation: AuthorPolicy = {
    canAuthor(principalId) {
      return check(identity, principalId, "materials:author");
    },
    canPublish({ principalId }) {
      return check(identity, principalId, "materials:publish");
    },
  };
  return Object.freeze(implementation);
}

async function check(
  identity: PermissionChecker,
  principalId: string,
  permission: PlatformPermission,
): Promise<boolean> {
  const decision = await identity.checkPermission({ principalId, permission });
  if (!decision.ok) {
    throw new Error("Identity permission check failed");
  }
  return decision.allowed;
}
