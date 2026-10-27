import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { AccountId } from "../../../accounts/index.js";
import type {
  AccountProfileResult,
  PrivateProfileState,
  ReadPrivateProfileError,
} from "../../facets/account-profiles/account-profiles.interface.js";
import type { AccountProfilePersistence } from "../../infrastructure/prisma.js";
import {
  internalProfileError,
  profileFailure,
} from "../../shared/profile-result.js";
import { privateProfileProjection } from "../../shared/profile-projection.js";

export async function readPrivateProfile(
  prisma: AccountProfilePersistence,
  accountId: AccountId,
): Promise<AccountProfileResult<PrivateProfileState, ReadPrivateProfileError>> {
  try {
    const stored = await prisma.accountProfile.findUnique({
      where: { accountId },
    });
    if (stored === null) return { ok: true, value: { kind: "missing" } };

    const profile = privateProfileProjection(stored);
    return profile === null
      ? profileFailure(internalProfileError())
      : { ok: true, value: { kind: "profile", profile } };
  } catch (error) {
    return dependencyFailure(
      { module: "account-profiles", operation: "readPrivateProfile" },
      error,
      profileFailure(internalProfileError()),
    );
  }
}
