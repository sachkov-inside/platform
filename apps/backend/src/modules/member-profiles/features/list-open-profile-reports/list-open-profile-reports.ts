import {
  parsePublicProfileId,
  type PublicProfileId,
} from "../../domain/public-profile-id.js";
import type {
  MemberProfileError,
  MemberProfileResult,
} from "../../facets/member-profiles/member-profiles.interface.js";
import type { MemberProfilePersistenceClient } from "../../infrastructure/prisma.js";
import {
  internalProfileError,
  profileFailure,
} from "../../shared/profile-result.js";

export interface OpenProfileReport {
  readonly publicProfileId: PublicProfileId;
  readonly reason: "unsafe_content" | "impersonation" | "other";
  readonly createdAt: string;
}

export type ListOpenProfileReportsError = Extract<
  MemberProfileError,
  { readonly code: "internal_error" }
>;

export async function listOpenProfileReports(
  prisma: MemberProfilePersistenceClient,
): Promise<
  MemberProfileResult<readonly OpenProfileReport[], ListOpenProfileReportsError>
> {
  try {
    const reports = await prisma.memberProfileReport.findMany({
      where: { status: "open" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { publicProfileId: true, reason: true, createdAt: true },
    });
    const accepted: OpenProfileReport[] = [];
    for (const report of reports) {
      const publicProfileId = parsePublicProfileId(report.publicProfileId);
      const reason = profileReportReason(report.reason);
      if (publicProfileId === undefined || reason === undefined) {
        return profileFailure(internalProfileError());
      }
      accepted.push({
        publicProfileId,
        reason,
        createdAt: report.createdAt.toISOString(),
      });
    }
    return { ok: true, value: accepted };
  } catch {
    return profileFailure(internalProfileError());
  }
}

function profileReportReason(
  value: string,
): OpenProfileReport["reason"] | undefined {
  return value === "unsafe_content" || value === "impersonation" || value === "other"
    ? value
    : undefined;
}
