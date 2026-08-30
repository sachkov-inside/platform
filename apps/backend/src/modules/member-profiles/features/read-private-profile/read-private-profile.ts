import type { AccountId } from "../../../accounts/index.js";
import type {
  MemberProfileResult,
  PrivateProfileState,
  ReadPrivateProfileError,
} from "../../facets/member-profiles/member-profiles.interface.js";
import type { MemberProfilePersistence } from "../../infrastructure/prisma.js";
import {
  internalProfileError,
  profileFailure,
} from "../../shared/profile-result.js";
import { privateProfileProjection } from "../../shared/profile-projection.js";

export async function readPrivateProfile(
  prisma: MemberProfilePersistence,
  accountId: AccountId,
): Promise<MemberProfileResult<PrivateProfileState, ReadPrivateProfileError>> {
  try {
    const stored = await prisma.memberProfile.findUnique({
      where: { accountId },
    });
    if (stored === null) return { ok: true, value: { kind: "missing" } };

    const profile = privateProfileProjection(stored);
    return profile === null
      ? profileFailure(internalProfileError())
      : { ok: true, value: { kind: "profile", profile } };
  } catch {
    return profileFailure(internalProfileError());
  }
}
