import type { AccountId } from "../../../accounts/index.js";
import type { MembershipEntitlements } from "../../../membership-entitlements/index.js";
import { parsePublicProfileId } from "../../domain/public-profile-id.js";
import type { ViewMemberProfileResult } from "../../facets/member-profiles/member-profiles.interface.js";
import type { MemberProfilePersistence } from "../../infrastructure/prisma.js";
import { memberProfileProjection } from "../../shared/profile-projection.js";
import { internalProfileError } from "../../shared/profile-result.js";

export async function viewMemberProfile(
  prisma: MemberProfilePersistence,
  membershipEntitlements: Pick<MembershipEntitlements, "resolveForAccess">,
  viewerAccountId: AccountId,
  rawPublicProfileId: string,
): Promise<ViewMemberProfileResult> {
  const publicProfileId = parsePublicProfileId(rawPublicProfileId);
  if (publicProfileId === undefined) {
    return { ok: false, error: { code: "not_found" } };
  }

  try {
    const membership = await membershipEntitlements.resolveForAccess(viewerAccountId);
    if (membership.kind !== "active") {
      return { ok: false, error: { code: "not_found" } };
    }

    const profile = await prisma.memberProfile.findFirst({
      where: { publicProfileId, status: "active" },
      select: { publicProfileId: true, displayName: true, bio: true },
    });
    if (profile === null) return { ok: false, error: { code: "not_found" } };
    const projection = memberProfileProjection(profile);
    return projection === null
      ? { ok: false, error: internalProfileError() }
      : { ok: true, profile: projection };
  } catch {
    return { ok: false, error: internalProfileError() };
  }
}
