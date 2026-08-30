import type { DeleteMemberProfileCommand, MemberProfileResult } from "../../facets/member-profiles/member-profiles.interface.js";
import type { MemberProfilePersistenceClient } from "../../infrastructure/prisma.js";
import { appendMemberProfileAuditEvent } from "../../shared/profile-audit.js";
import {
  internalProfileError,
  profileFailure,
} from "../../shared/profile-result.js";

export async function deleteProfile(
  prisma: MemberProfilePersistenceClient,
  command: DeleteMemberProfileCommand,
): Promise<MemberProfileResult<Readonly<{ deleted: true }>>> {
  if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1) {
    return profileFailure({ code: "conflict" });
  }

  try {
    return await prisma.$transaction(async (transaction) => {
      const current = await transaction.memberProfile.findUnique({
        where: { accountId: command.accountId },
        select: { publicProfileId: true, version: true },
      });
      if (current === null) return profileFailure({ code: "profile_not_found" });
      if (current.version !== command.expectedVersion) {
        return profileFailure({
          code: "conflict",
          currentVersion: current.version,
        });
      }

      const deleted = await transaction.memberProfile.deleteMany({
        where: {
          accountId: command.accountId,
          version: command.expectedVersion,
        },
      });
      if (deleted.count === 0) return profileFailure({ code: "conflict" });
      await appendMemberProfileAuditEvent(
        transaction,
        "profile_deleted",
        command.accountId,
        current.publicProfileId,
      );
      return { ok: true, value: { deleted: true } };
    });
  } catch {
    return profileFailure(internalProfileError());
  }
}
