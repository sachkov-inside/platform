import { Prisma } from "../../../../infrastructure/prisma/index.js";
import type { ObjectStorage } from "../../../../infrastructure/object-storage/index.js";
import type { MemberProfilePersistenceClient } from "../../infrastructure/prisma.js";

export const PROFILE_AVATAR_MAINTENANCE = Symbol("PROFILE_AVATAR_MAINTENANCE");

export interface CleanupProfileAvatarOrphansInput {
  readonly graceMs: number;
  readonly now?: Date;
}

export type CleanupProfileAvatarsResult = Readonly<{
  cleaned: number;
  retained: number;
}>;

export interface ProfileAvatarMaintenance {
  cleanup(input: CleanupProfileAvatarOrphansInput): Promise<CleanupProfileAvatarsResult>;
}

export function assembleProfileAvatarMaintenance(dependencies: {
  readonly objectStorage: ObjectStorage;
  readonly prisma: MemberProfilePersistenceClient;
}): ProfileAvatarMaintenance {
  return Object.freeze({
    cleanup: (input: CleanupProfileAvatarOrphansInput) =>
      cleanupProfileAvatarOrphans(dependencies, input),
  });
}

export async function cleanupProfileAvatarOrphans(
  dependencies: {
    readonly objectStorage: ObjectStorage;
    readonly prisma: MemberProfilePersistenceClient;
  },
  input: CleanupProfileAvatarOrphansInput,
): Promise<CleanupProfileAvatarsResult> {
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - input.graceMs);
  const candidates = await dependencies.prisma.profileAvatar.findMany({
    orderBy: { orphanedAt: "asc" },
    select: { id: true },
    take: 100,
    where: { orphanedAt: { lte: cutoff }, updatedAt: { lte: cutoff } },
  });
  let cleaned = 0;
  let retained = 0;
  for (const candidate of candidates) {
    const claimed = await dependencies.prisma.$transaction(async (transaction) => {
      const avatar = await transaction.profileAvatar.findUnique({
        include: { renditions: true },
        where: { id: candidate.id },
      });
      if (avatar === null || avatar.orphanedAt > cutoff || avatar.updatedAt > cutoff) {
        return null;
      }
      await transaction.$executeRaw(Prisma.sql`
        select pg_advisory_xact_lock(hashtextextended(${avatar.accountId}, 0))
      `);
      const current = await transaction.memberProfile.findUnique({
        select: { avatarId: true },
        where: { accountId: avatar.accountId },
      });
      if (current?.avatarId === avatar.id) {
        await transaction.profileAvatar.update({
          data: { currentlyReferenced: true, orphanedAt: now, updatedAt: now },
          where: { id: avatar.id },
        });
        return { kind: "retained" as const };
      }
      const claim = await transaction.profileAvatar.updateMany({
        data: {
          cleanupClaimedAt: now,
          currentlyReferenced: false,
          failureCode: "cleanup_claimed",
          state: "failed",
          updatedAt: now,
        },
        where: { id: avatar.id, updatedAt: { lte: cutoff } },
      });
      return claim.count === 1 ? { avatar, kind: "claimed" as const } : null;
    });
    if (claimed?.kind === "retained") {
      retained += 1;
      continue;
    }
    if (claimed?.kind !== "claimed") continue;
    try {
      for (const rendition of claimed.avatar.renditions) {
        await dependencies.objectStorage.delete(
          "protected",
          rendition.protectedObjectKey,
        );
      }
      await dependencies.prisma.profileAvatar.delete({
        where: { id: claimed.avatar.id },
      });
      cleaned += 1;
    } catch {
      retained += 1;
    }
  }
  return { cleaned, retained };
}
