import type { MemberProfilePersistenceClient } from "../../infrastructure/prisma.js";

export interface OpenProfileReport {
  readonly publicProfileId: string;
  readonly reason: "unsafe_content" | "impersonation" | "other";
  readonly createdAt: string;
}

export async function listOpenProfileReports(
  prisma: MemberProfilePersistenceClient,
): Promise<readonly OpenProfileReport[]> {
  const reports = await prisma.memberProfileReport.findMany({
    where: { status: "open" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { publicProfileId: true, reason: true, createdAt: true },
  });
  return reports.flatMap((report) => {
    const reason = profileReportReason(report.reason);
    return reason === undefined
      ? []
      : [
          {
            publicProfileId: report.publicProfileId,
            reason,
            createdAt: report.createdAt.toISOString(),
          },
        ];
  });
}

function profileReportReason(
  value: string,
): OpenProfileReport["reason"] | undefined {
  return value === "unsafe_content" || value === "impersonation" || value === "other"
    ? value
    : undefined;
}
