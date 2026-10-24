import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type {
  CreateAccountProfileError,
  CreateAccountProfileCommand,
  AccountProfileResult,
  PrivateAccountProfile,
} from "../../facets/account-profiles/account-profiles.interface.js";
import { acceptAccountProfileFields } from "../../domain/profile-fields.js";
import { newPublicProfileId } from "../../domain/public-profile-id.js";
import type { AccountProfilePersistenceClient } from "../../infrastructure/prisma.js";
import { appendAccountProfileAuditEvent } from "../../shared/profile-audit.js";
import { privateProfileProjection } from "../../shared/profile-projection.js";
import {
  internalProfileError,
  profileFailure,
} from "../../shared/profile-result.js";

export async function createProfile(
  prisma: AccountProfilePersistenceClient,
  command: CreateAccountProfileCommand,
): Promise<
  AccountProfileResult<PrivateAccountProfile, CreateAccountProfileError>
> {
  const accepted = acceptAccountProfileFields(command);
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
      await appendAccountProfileAuditEvent(
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
  } catch (error) {
    // Уже созданный профиль — гонка двух запросов, а не сбой.
    try {
      const existing = await prisma.memberProfile.findUnique({
        where: { accountId: command.accountId },
        select: { accountId: true },
      });
      return existing === null
        ? dependencyFailure(
            { module: "account-profiles", operation: "createProfile" },
            error,
            profileFailure(internalProfileError()),
          )
        : profileFailure({ code: "profile_exists" });
    } catch (lookupError) {
      return dependencyFailure(
        { module: "account-profiles", operation: "createProfile" },
        lookupError,
        profileFailure(internalProfileError()),
      );
    }
  }
}
