import type { WorkshopPrisma } from "../../infrastructure/prisma.js";
import type { LoadWorkshopCaseResult } from "../../facets/workshop/workshop.interface.js";
import { workshopCaseSlugSchema } from "../../shared/workshop-validation.js";

export async function loadCurrentWorkshopCase(
  prisma: WorkshopPrisma,
  caseSlug: string,
): Promise<LoadWorkshopCaseResult> {
  if (!workshopCaseSlugSchema.safeParse(caseSlug).success) {
    return { ok: false, error: { code: "invalid_request" } };
  }
  try {
    const workshopCase = await prisma.workshopCase.findUnique({
      where: { slug: caseSlug },
      include: { currentVersion: true },
    });
    if (
      workshopCase === null ||
      workshopCase.lifecycle !== "published" ||
      workshopCase.currentVersion === null ||
      workshopCase.currentVersion.withdrawnAt !== null
    ) {
      return { ok: false, error: { code: "case_not_found" } };
    }
    const version = workshopCase.currentVersion;
    return {
      ok: true,
      value: {
        caseId: workshopCase.id,
        caseSlug: workshopCase.slug,
        caseVersionId: version.id,
        caseVersion: version.caseVersion,
        contentDigest: version.contentDigest,
        publishedAt: version.publishedAt.toISOString(),
      },
    };
  } catch {
    return { ok: false, error: { code: "dependency_unavailable" } };
  }
}
