import type { ObjectStorage } from "../../../../infrastructure/object-storage/index.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { AccountId } from "../../../accounts/index.js";
import { parseProfileAvatarId } from "../../domain/profile-avatar-id.js";
import type { DeliverProfileAvatarResult } from "../../facets/member-profiles/member-profiles.interface.js";
import type { MemberProfilePersistenceClient } from "../../infrastructure/prisma.js";

/**
 * A Profile is seen only by its owner (owner decision 15.09.2026, Workspace #185), so the avatar
 * rendition is signed only for the Account that owns the Profile. There is no member or public
 * branch: another Account gets the same not-found answer as a missing avatar.
 */
export async function deliverProfileAvatar(
  dependencies: {
    readonly objectStorage: ObjectStorage;
    readonly prisma: MemberProfilePersistenceClient;
    readonly signedGetTtlSeconds: number;
  },
  input: {
    readonly accountId: AccountId;
    readonly avatarId: string;
    readonly size: 160 | 320 | 640;
  },
): Promise<DeliverProfileAvatarResult> {
  const avatarId = parseProfileAvatarId(input.avatarId);
  if (avatarId === undefined) return notFound();

  try {
    const profile = await dependencies.prisma.memberProfile.findUnique({
      where: { accountId: input.accountId },
      select: { avatarId: true, status: true },
    });
    if (
      profile === null ||
      profile.avatarId !== avatarId ||
      profile.status !== "active"
    ) {
      return notFound();
    }
    const rendition = await dependencies.prisma.profileAvatarRendition.findUnique({
      where: { avatarId_size: { avatarId, size: input.size } },
      include: { avatar: { select: { accountId: true, state: true } } },
    });
    if (
      rendition === null ||
      rendition.avatar.accountId !== input.accountId ||
      rendition.avatar.state !== "ready"
    ) {
      return notFound();
    }
    const location = await dependencies.objectStorage.signGet({
      contentType: "image/webp",
      key: rendition.protectedObjectKey,
      namespace: "protected",
      ttlSeconds: dependencies.signedGetTtlSeconds,
    });
    return { location, ok: true };
  } catch (error) {
    return dependencyFailure({ module: "member-profiles", operation: "deliverProfileAvatar" }, error, { error: { code: "dependency_unavailable" }, ok: false });
  }
}

function notFound(): DeliverProfileAvatarResult {
  return { error: { code: "not_found" }, ok: false };
}
