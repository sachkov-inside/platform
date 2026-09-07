import { loadMaterialResumes } from "../../shared/load-material-resumes.js";
import { z } from "zod";
import type { ReadingActivityPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { accountId } from "../../../accounts/index.js";
import type { ContentAccess } from "../../../content-access/index.js";
import { readAvailableMaterials, type PublishedMaterialCatalogItemDto } from "../../../content-library/index.js";
import type { PublishedMaterialSelection } from "../../../materials/index.js";
import type { Videos } from "../../../videos/index.js";
const MAX_RECENT_VISITS = 500;
const MATERIAL_BATCH_SIZE = 100;
const CONTINUE_LIMIT = 6;
export interface ContinueMaterial {
  readonly material: PublishedMaterialCatalogItemDto;
  readonly lastOpenedAt: string;
  readonly resume: { readonly kind: "start" } | { readonly kind: "position"; readonly positionSeconds: number } | { readonly kind: "reached-end" };
}
export type GetContinueMaterialsResult = { readonly ok: true; readonly value: readonly ContinueMaterial[] } | { readonly ok: false; readonly error: { readonly code: "invalid_request" | "dependency_unavailable" } };
export async function getContinueMaterials(dependencies: {
  readonly prisma: ReadingActivityPrismaClient;
  readonly selection: Pick<PublishedMaterialSelection, "read">;
  readonly contentAccess: Pick<ContentAccess, "checkAvailabilityMany">;
  readonly videos: Pick<Videos, "loadReadyDurations" | "loadProgressMany">;
}, account: string): Promise<GetContinueMaterialsResult> {
  if (!z.uuid().safeParse(account).success) return { ok: false, error: { code: "invalid_request" } };
  const subject = { kind: "account" as const, accountId: accountId(account) };
  try {
    const visits = await dependencies.prisma.readingMaterialVisit.findMany({ where: { accountId: account }, orderBy: [{ lastOpenedAt: "desc" }, { materialId: "asc" }], take: MAX_RECENT_VISITS });
    const candidates: Omit<ContinueMaterial, "resume">[] = [];
    for (let offset = 0; offset < visits.length && candidates.length < CONTINUE_LIMIT; offset += MATERIAL_BATCH_SIZE) {
      const batch = visits.slice(offset, offset + MATERIAL_BATCH_SIZE);
      const completed = await dependencies.prisma.readingMaterialState.findMany({ where: { accountId: account, isRead: true, materialId: { in: batch.map((visit) => visit.materialId) } }, select: { materialId: true } });
      const readIds = new Set(completed.map((state) => state.materialId));
      const unfinished = batch.filter((visit) => !readIds.has(visit.materialId));
      const content = await readAvailableMaterials(dependencies, subject, unfinished.map((visit) => visit.materialId));
      if (!content.ok) return content;
      const byId = new Map(content.value.map((material) => [material.materialId, material]));
      for (const visit of unfinished) {
        const material = byId.get(visit.materialId);
        if (material !== undefined && candidates.length < CONTINUE_LIMIT) candidates.push({ material, lastOpenedAt: visit.lastOpenedAt.toISOString() });
      }
    }
    const resumes = await loadMaterialResumes(dependencies, subject, candidates.map((candidate) => candidate.material));
    return { ok: true, value: candidates.map((candidate): ContinueMaterial => ({ ...candidate, resume: resumes.get(candidate.material.materialId) ?? { kind: "start" } })) };
  } catch { return { ok: false, error: { code: "dependency_unavailable" } }; }
}
