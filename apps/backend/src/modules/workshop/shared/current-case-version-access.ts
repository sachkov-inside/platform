import type { WorkshopPrisma } from "../infrastructure/prisma.js";
import { resolveWorkshopAccess } from "../features/resolve-access/resolve-access.js";

export async function resolveCurrentCaseVersionAccess(
  prisma: WorkshopPrisma,
  accountId: string,
  caseVersionId: string,
  now: Date,
) {
  const version = await prisma.workshopCaseVersion.findUnique({
    where: { id: caseVersionId },
    include: { currentFor: true },
  });
  if (
    version === null ||
    version.withdrawnAt !== null ||
    version.currentFor === null ||
    version.currentFor.lifecycle !== "published"
  ) {
    return undefined;
  }
  const access = await resolveWorkshopAccess(
    prisma,
    { accountId, workshopScope: version.currentFor.workshopScope },
    now,
  );
  return access.kind === "active" ? access : undefined;
}
