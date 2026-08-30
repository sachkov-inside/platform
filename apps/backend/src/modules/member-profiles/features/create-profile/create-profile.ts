import type {
  CreateMemberProfileCommand,
  MemberProfileResult,
  PrivateMemberProfile,
} from "../../facets/member-profiles/member-profiles.interface.js";
import { acceptMemberProfileFields } from "../../domain/profile-fields.js";
import { newPublicProfileId } from "../../domain/public-profile-id.js";
import type { MemberProfilePersistenceClient } from "../../infrastructure/prisma.js";
import { appendMemberProfileAuditEvent } from "../../shared/profile-audit.js";
import { privateProfileProjection } from "../../shared/profile-projection.js";
import {
  internalProfileError,
  profileFailure,
} from "../../shared/profile-result.js";

export async function createProfile(
  prisma: MemberProfilePersistenceClient,
  command: CreateMemberProfileCommand,
): Promise<MemberProfileResult<PrivateMemberProfile>> {
  const accepted = acceptMemberProfileFields(command);
  if (!accepted.ok) {
    return profileFailure({ code: "invalid_input", issues: accepted.issues });
  }

  try {
    return await prisma.$transaction(async (transaction) => {
      const existing = await transaction.memberProfile.findUnique({
        where: { accountId: command.accountId },
        select: { accountId: true },
      });
      if (existing !== null) return profileFailure({ code: "profile_exists" });

      const publicProfileId = newPublicProfileId();
      const stored = await transaction.memberProfile.create({
        data: {
          accountId: command.accountId,
          publicProfileId,
          displayName: accepted.fields.displayName,
          bio: accepted.fields.bio,
          status: "active",
        },
      });
      await appendMemberProfileAuditEvent(
        transaction,
        "profile_created",
        command.accountId,
        publicProfileId,
      );
      const profile = privateProfileProjection(stored);
      return profile === null
        ? profileFailure(internalProfileError())
        : { ok: true, value: profile };
    });
  } catch {
    try {
      const existing = await prisma.memberProfile.findUnique({
        where: { accountId: command.accountId },
        select: { accountId: true },
      });
      return existing === null
        ? profileFailure(internalProfileError())
        : profileFailure({ code: "profile_exists" });
    } catch {
      return profileFailure(internalProfileError());
    }
  }
}
