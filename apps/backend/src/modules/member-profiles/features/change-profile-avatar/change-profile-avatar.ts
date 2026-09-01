import { randomUUID } from "node:crypto";

import { Prisma } from "../../../../infrastructure/prisma/index.js";
import type { ObjectStorage } from "../../../../infrastructure/object-storage/index.js";
import type { AccountId } from "../../../accounts/index.js";
import type {
  ChangeProfileAvatarCommand,
  ChangeProfileAvatarResult,
} from "../../facets/member-profiles/member-profiles.interface.js";
import { newProfileAvatarId } from "../../domain/profile-avatar-id.js";
import type { MemberProfilePersistenceClient } from "../../infrastructure/prisma.js";
import { privateProfileProjection } from "../../shared/profile-projection.js";
import {
  processProfileAvatar,
  type ProcessedProfileAvatarRendition,
} from "./process-profile-avatar.js";

interface PersistenceDependencies {
  readonly objectStorage: ObjectStorage;
  readonly prisma: MemberProfilePersistenceClient;
}

export async function changeProfileAvatar(
  dependencies: PersistenceDependencies,
  command: ChangeProfileAvatarCommand,
): Promise<ChangeProfileAvatarResult> {
  try {
    const profile = await dependencies.prisma.memberProfile.findUnique({
      where: { accountId: command.accountId },
    });
    if (profile === null) return { error: { code: "profile_not_found" }, ok: false };
    if (profile.version !== command.expectedVersion) {
      return conflict(profile.version);
    }
    if (command.kind === "remove") {
      return await removeAvatar(dependencies, command.accountId, command.expectedVersion);
    }

    const processed = await processProfileAvatar(command);
    if (!processed.ok) {
      return {
        error: { code: "invalid_avatar", reason: processed.error.reason },
        ok: false,
      };
    }
    return await uploadAvatar(
      dependencies,
      command.accountId,
      command.expectedVersion,
      processed.renditions,
    );
  } catch {
    return { error: { code: "dependency_unavailable" }, ok: false };
  }
}

async function uploadAvatar(
  { objectStorage, prisma }: PersistenceDependencies,
  accountId: AccountId,
  expectedVersion: number,
  renditions: readonly ProcessedProfileAvatarRendition[],
): Promise<ChangeProfileAvatarResult> {
  const avatarId = newProfileAvatarId();
  const now = new Date();
  const rows = renditions.map((rendition) => ({
    byteSize: rendition.body.byteLength,
    checksumSha256: rendition.checksumSha256,
    contentType: rendition.contentType,
    protectedObjectKey: `member-profiles/${accountId}/avatars/${avatarId}/${rendition.size}.webp`,
    size: rendition.size,
  }));
  await prisma.profileAvatar.create({
    data: {
      accountId,
      id: avatarId,
      orphanedAt: now,
      renditions: { createMany: { data: rows } },
      state: "processing",
      updatedAt: now,
    },
  });

  try {
    const outcomes = await Promise.allSettled(
      rows.map(async (row, index) => {
        const rendition = renditions[index];
        if (rendition === undefined) throw new Error("Missing rendition");
        const result = await objectStorage.putImmutable({
          body: rendition.body,
          checksumSha256: row.checksumSha256,
          contentType: row.contentType,
          key: row.protectedObjectKey,
          namespace: "protected",
        });
        if (!result.ok) throw new Error(result.error.code);
      }),
    );
    if (outcomes.some((outcome) => outcome.status === "rejected")) {
      throw new Error("Profile avatar storage failed");
    }
  } catch {
    await prisma.profileAvatar.updateMany({
      data: { failureCode: "storage_failure", state: "failed", updatedAt: new Date() },
      where: { id: avatarId, state: "processing" },
    });
    return { error: { code: "dependency_unavailable" }, ok: false };
  }

  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw(Prisma.sql`
      select pg_advisory_xact_lock(hashtextextended(${accountId}, 0))
    `);
    const current = await transaction.memberProfile.findUnique({
      where: { accountId },
    });
    if (current === null) {
      await transaction.profileAvatar.update({
        data: { failureCode: "profile_not_found", state: "failed", updatedAt: new Date() },
        where: { id: avatarId },
      });
      return { error: { code: "profile_not_found" }, ok: false };
    }
    const changed = await transaction.memberProfile.updateMany({
      data: { avatarId, updatedAt: new Date(), version: { increment: 1 } },
      where: { accountId, version: expectedVersion },
    });
    if (changed.count !== 1) {
      await transaction.profileAvatar.update({
        data: { failureCode: "version_conflict", state: "failed", updatedAt: new Date() },
        where: { id: avatarId },
      });
      return conflict(current.version);
    }
    await transaction.profileAvatar.update({
      data: {
        currentlyReferenced: true,
        failureCode: null,
        readyAt: new Date(),
        state: "ready",
        updatedAt: new Date(),
      },
      where: { id: avatarId },
    });
    if (current.avatarId !== null) {
      await transaction.profileAvatar.updateMany({
        data: {
          currentlyReferenced: false,
          orphanedAt: new Date(),
          updatedAt: new Date(),
        },
        where: { accountId, id: current.avatarId },
      });
    }
    await transaction.memberProfileAuditEvent.create({
      data: {
        accountId,
        event: current.avatarId === null ? "avatar_uploaded" : "avatar_replaced",
        id: randomUUID(),
        publicProfileId: current.publicProfileId,
      },
    });
    const updated = await transaction.memberProfile.findUnique({ where: { accountId } });
    const projection = updated === null ? null : privateProfileProjection(updated);
    if (projection === null) throw new TypeError("Invalid Profile persistence");
    return { ok: true, profile: projection };
  });
}

async function removeAvatar(
  { prisma }: PersistenceDependencies,
  accountId: AccountId,
  expectedVersion: number,
): Promise<ChangeProfileAvatarResult> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw(Prisma.sql`
      select pg_advisory_xact_lock(hashtextextended(${accountId}, 0))
    `);
    const current = await transaction.memberProfile.findUnique({ where: { accountId } });
    if (current === null) return { error: { code: "profile_not_found" }, ok: false };
    const changed = await transaction.memberProfile.updateMany({
      data: { avatarId: null, updatedAt: new Date(), version: { increment: 1 } },
      where: { accountId, version: expectedVersion },
    });
    if (changed.count !== 1) return conflict(current.version);
    if (current.avatarId !== null) {
      await transaction.profileAvatar.updateMany({
        data: {
          currentlyReferenced: false,
          orphanedAt: new Date(),
          updatedAt: new Date(),
        },
        where: { accountId, id: current.avatarId },
      });
      await transaction.memberProfileAuditEvent.create({
        data: {
          accountId,
          event: "avatar_removed",
          id: randomUUID(),
          publicProfileId: current.publicProfileId,
        },
      });
    }
    const updated = await transaction.memberProfile.findUnique({ where: { accountId } });
    const projection = updated === null ? null : privateProfileProjection(updated);
    if (projection === null) throw new TypeError("Invalid Profile persistence");
    return { ok: true, profile: projection };
  });
}

function conflict(currentVersion: number): ChangeProfileAvatarResult {
  return { error: { code: "conflict", currentVersion }, ok: false };
}
