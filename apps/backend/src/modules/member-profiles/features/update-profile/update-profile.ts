import type {
  MemberProfileResult,
  PrivateMemberProfile,
  UpdateMemberProfileCommand,
} from "../../facets/member-profiles/member-profiles.interface.js";
import { acceptMemberProfileFields } from "../../domain/profile-fields.js";
import type { MemberProfilePersistenceClient } from "../../infrastructure/prisma.js";
import { appendMemberProfileAuditEvent } from "../../shared/profile-audit.js";
import { privateProfileProjection } from "../../shared/profile-projection.js";
import {
  internalProfileError,
  profileFailure,
} from "../../shared/profile-result.js";

export async function updateProfile(
  prisma: MemberProfilePersistenceClient,
  command: UpdateMemberProfileCommand,
): Promise<MemberProfileResult<PrivateMemberProfile>> {
  const accepted = acceptMemberProfileFields(command);
  if (!accepted.ok) {
    return profileFailure({ code: "invalid_input", issues: accepted.issues });
  }
  if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1) {
    return profileFailure({
      code: "invalid_input",
      issues: [{ field: "displayName", code: "invalid_characters" }],
    });
  }

  try {
    return await prisma.$transaction(async (transaction) => {
      const updated = await transaction.memberProfile.updateMany({
        where: {
          accountId: command.accountId,
          version: command.expectedVersion,
        },
        data: {
          displayName: accepted.fields.displayName,
          bio: accepted.fields.bio,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        const current = await transaction.memberProfile.findUnique({
          where: { accountId: command.accountId },
          select: { version: true },
        });
        return current === null
          ? profileFailure({ code: "profile_not_found" })
          : profileFailure({ code: "conflict", currentVersion: current.version });
      }

      const stored = await transaction.memberProfile.findUniqueOrThrow({
        where: { accountId: command.accountId },
      });
      await appendMemberProfileAuditEvent(
        transaction,
        "profile_updated",
        command.accountId,
        stored.publicProfileId,
      );
      const profile = privateProfileProjection(stored);
      return profile === null
        ? profileFailure(internalProfileError())
        : { ok: true, value: profile };
    });
  } catch {
    return profileFailure(internalProfileError());
  }
}
