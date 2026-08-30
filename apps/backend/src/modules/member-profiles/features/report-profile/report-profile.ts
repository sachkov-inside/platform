import { randomUUID } from "node:crypto";

import { parseAccountId, type AccountId } from "../../../accounts/index.js";
import type { MembershipEntitlements } from "../../../membership-entitlements/index.js";
import { parsePublicProfileId } from "../../domain/public-profile-id.js";
import type {
  MemberProfileReportReason,
  ReportMemberProfileResult,
} from "../../facets/member-profiles/member-profiles.interface.js";
import type { MemberProfilePersistenceClient } from "../../infrastructure/prisma.js";
import { appendMemberProfileAuditEvent } from "../../shared/profile-audit.js";
import { internalProfileError } from "../../shared/profile-result.js";

export async function reportProfile(
  prisma: MemberProfilePersistenceClient,
  membershipEntitlements: Pick<MembershipEntitlements, "resolveForAccess">,
  reporterAccountId: AccountId,
  rawPublicProfileId: string,
  reason: MemberProfileReportReason,
): Promise<ReportMemberProfileResult> {
  const publicProfileId = parsePublicProfileId(rawPublicProfileId);
  if (publicProfileId === undefined) {
    return { ok: false, error: { code: "not_found" } };
  }

  try {
    const membership = await membershipEntitlements.resolveForAccess(reporterAccountId);
    if (membership.kind !== "active") {
      return { ok: false, error: { code: "not_found" } };
    }

    return await prisma.$transaction(async (transaction) => {
      const profile = await transaction.memberProfile.findFirst({
        where: { publicProfileId, status: "active" },
        select: { accountId: true },
      });
      const profileAccountId = parseAccountId(profile?.accountId);
      if (profileAccountId === undefined || profileAccountId === reporterAccountId) {
        return { ok: false, error: { code: "not_found" } };
      }

      const existing = await transaction.memberProfileReport.findUnique({
        where: {
          publicProfileId_reporterAccountId: {
            publicProfileId,
            reporterAccountId,
          },
        },
        select: { status: true },
      });
      if (existing?.status === "open") {
        return { ok: true, outcome: "already_recorded" };
      }

      await transaction.memberProfileReport.upsert({
        where: {
          publicProfileId_reporterAccountId: {
            publicProfileId,
            reporterAccountId,
          },
        },
        create: {
          id: randomUUID(),
          publicProfileId,
          reporterAccountId,
          reason,
          status: "open",
        },
        update: { reason, status: "open", updatedAt: new Date() },
      });
      await appendMemberProfileAuditEvent(
        transaction,
        "profile_reported",
        profileAccountId,
        publicProfileId,
      );
      return { ok: true, outcome: "recorded" };
    });
  } catch {
    return { ok: false, error: internalProfileError() };
  }
}
