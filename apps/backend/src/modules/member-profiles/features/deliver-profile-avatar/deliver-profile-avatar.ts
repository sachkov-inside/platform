import type { ObjectStorage } from "../../../../infrastructure/object-storage/index.js";
import type { AccountId } from "../../../accounts/index.js";
import type { MembershipEntitlements } from "../../../membership-entitlements/index.js";
import { parseProfileAvatarId } from "../../domain/profile-avatar-id.js";
import { parsePublicProfileId } from "../../domain/public-profile-id.js";
import type { DeliverProfileAvatarResult } from "../../facets/member-profiles/member-profiles.interface.js";
import type { MemberProfilePersistenceClient } from "../../infrastructure/prisma.js";

export async function deliverProfileAvatar(
  dependencies: {
    readonly membershipEntitlements: Pick<MembershipEntitlements, "resolveForAccess">;
    readonly objectStorage: ObjectStorage;
    readonly prisma: MemberProfilePersistenceClient;
    readonly signedGetTtlSeconds: number;
  },
  input: {
    readonly avatarId: string;
    readonly publicProfileId: string;
    readonly size: 160 | 320 | 640;
    readonly viewerAccountId: AccountId;
  },
): Promise<DeliverProfileAvatarResult> {
  const avatarId = parseProfileAvatarId(input.avatarId);
  const publicProfileId = parsePublicProfileId(input.publicProfileId);
  if (avatarId === undefined || publicProfileId === undefined) return notFound();

  try {
    const membership = await dependencies.membershipEntitlements.resolveForAccess(
      input.viewerAccountId,
    );
    if (membership.kind !== "active") return notFound();
    const ttlSeconds = remainingMembershipTtlSeconds(
      dependencies.signedGetTtlSeconds,
      membership.validUntil,
    );
    if (ttlSeconds === null) return notFound();

    const profile = await dependencies.prisma.memberProfile.findUnique({
      where: { publicProfileId },
      select: { accountId: true, avatarId: true, status: true },
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
      rendition.avatar.accountId !== profile.accountId ||
      rendition.avatar.state !== "ready"
    ) {
      return notFound();
    }
    const location = await dependencies.objectStorage.signGet({
      contentType: "image/webp",
      key: rendition.protectedObjectKey,
      namespace: "protected",
      ttlSeconds,
    });
    return { location, ok: true };
  } catch {
    return { error: { code: "dependency_unavailable" }, ok: false };
  }
}

function remainingMembershipTtlSeconds(
  configuredTtlSeconds: number,
  validUntil: string,
): number | null {
  const remainingWholeSeconds = Math.floor(
    (Date.parse(validUntil) - Date.now()) / 1_000,
  );
  const boundedTtlSeconds = Math.min(
    configuredTtlSeconds,
    remainingWholeSeconds - 1,
  );
  return boundedTtlSeconds >= 1 ? boundedTtlSeconds : null;
}

function notFound(): DeliverProfileAvatarResult {
  return { error: { code: "not_found" }, ok: false };
}
