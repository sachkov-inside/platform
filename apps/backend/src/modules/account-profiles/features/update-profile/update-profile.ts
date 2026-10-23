import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type {
  AccountProfileResult,
  PrivateAccountProfile,
  UpdateAccountProfileError,
  UpdateAccountProfileCommand,
} from "../../facets/account-profiles/account-profiles.interface.js";
import { acceptAccountProfileFields } from "../../domain/profile-fields.js";
import { parsePublicProfileId } from "../../domain/public-profile-id.js";
import type { AccountProfilePersistenceClient } from "../../infrastructure/prisma.js";
import { appendAccountProfileAuditEvent } from "../../shared/profile-audit.js";
import { privateProfileProjection } from "../../shared/profile-projection.js";
import {
  internalProfileError,
  profileFailure,
} from "../../shared/profile-result.js";

export async function updateProfile(
  prisma: AccountProfilePersistenceClient,
  command: UpdateAccountProfileCommand,
): Promise<
  AccountProfileResult<PrivateAccountProfile, UpdateAccountProfileError>
> {
  const accepted = acceptAccountProfileFields(command);
  if (!accepted.ok) {
    return profileFailure({ code: "invalid_input", issues: accepted.issues });
  }
  if (
    !Number.isSafeInteger(command.expectedVersion) ||
    command.expectedVersion < 1
  ) {
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
          : profileFailure({
              code: "conflict",
              currentVersion: current.version,
            });
      }

      const stored = await transaction.memberProfile.findUniqueOrThrow({
        where: { accountId: command.accountId },
      });
      const publicProfileId = parsePublicProfileId(stored.publicProfileId);
      if (publicProfileId === undefined) {
        return profileFailure(internalProfileError());
      }
      await appendAccountProfileAuditEvent(
        transaction,
        "profile_updated",
        command.accountId,
        publicProfileId,
      );
      const profile = privateProfileProjection(stored);
      return profile === null
        ? profileFailure(internalProfileError())
        : { ok: true, value: profile };
    });
  } catch (error) {
    return dependencyFailure(
      { module: "account-profiles", operation: "updateProfile" },
      error,
      profileFailure(internalProfileError()),
    );
  }
}
