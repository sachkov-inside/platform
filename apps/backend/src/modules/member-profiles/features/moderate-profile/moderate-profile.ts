import { parseAccountId } from "../../../accounts/index.js";
import { parsePublicProfileId } from "../../domain/public-profile-id.js";
import type { MemberProfilePersistenceClient } from "../../infrastructure/prisma.js";
import { appendMemberProfileAuditEvent } from "../../shared/profile-audit.js";
import { internalProfileError } from "../../shared/profile-result.js";

export type ProfileModerationAction = "disable" | "restore";

export type ModerateMemberProfileResult =
  | Readonly<{
      ok: true;
      changed: boolean;
      status: "active" | "disabled";
      publicProfileId: string;
    }>
  | Readonly<{
      ok: false;
      error:
        | Readonly<{ code: "profile_not_found" }>
        | Readonly<{ code: "internal_error"; correlationId: string }>;
    }>;

export async function moderateMemberProfile(
  prisma: MemberProfilePersistenceClient,
  rawPublicProfileId: string,
  action: ProfileModerationAction,
): Promise<ModerateMemberProfileResult> {
  const publicProfileId = parsePublicProfileId(rawPublicProfileId);
  if (publicProfileId === undefined) {
    return { ok: false, error: { code: "profile_not_found" } };
  }
  const targetStatus = action === "disable" ? "disabled" : "active";

  try {
    return await prisma.$transaction(async (transaction) => {
      const current = await transaction.memberProfile.findUnique({
        where: { publicProfileId },
        select: { accountId: true, status: true },
      });
      const accountId = parseAccountId(current?.accountId);
      if (current === null || accountId === undefined) {
        return { ok: false, error: { code: "profile_not_found" } };
      }
      if (current.status === targetStatus) {
        return {
          ok: true,
          changed: false,
          status: targetStatus,
          publicProfileId,
        };
      }

      await transaction.memberProfile.update({
        where: { publicProfileId },
        data: {
          status: targetStatus,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      await appendMemberProfileAuditEvent(
        transaction,
        action === "disable" ? "profile_disabled" : "profile_restored",
        accountId,
        publicProfileId,
      );
      return {
        ok: true,
        changed: true,
        status: targetStatus,
        publicProfileId,
      };
    });
  } catch {
    return { ok: false, error: internalProfileError() };
  }
}
