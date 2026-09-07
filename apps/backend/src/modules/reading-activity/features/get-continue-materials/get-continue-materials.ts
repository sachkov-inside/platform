import { randomUUID } from "node:crypto";
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
    const videoIds = candidates.flatMap(({ material }) => material.primaryVideoId === null ? [] : [material.primaryVideoId]);
    let progress: readonly { readonly videoId: string; readonly positionSeconds: number; readonly durationSeconds: number }[] = [];
    if (videoIds.length > 0) {
      try {
        const access = await dependencies.contentAccess.checkAvailabilityMany({ subject, operations: videoIds.map((id) => ({ itemId: id, resource: { kind: "video" as const, videoId: id }, action: "play" as const })), enforcementPoint: "personal_home", correlationId: randomUUID() });
        const allowed = access.ok ? access.items.filter((item) => item.availability === "available").map((item) => item.itemId) : [];
        const result = await dependencies.videos.loadProgressMany({ accountId: account, videoIds: allowed });
        if (result.ok) progress = result.value;
      } catch { /* Resume failure leaves safe Material cards usable. */ }
    }
    const byVideoId = new Map(progress.map((item) => [item.videoId, item]));
    return { ok: true, value: candidates.map((candidate): ContinueMaterial => {
      const saved = candidate.material.primaryVideoId === null ? undefined : byVideoId.get(candidate.material.primaryVideoId);
      const duration = candidate.material.primaryVideoDurationSeconds;
      const resume: ContinueMaterial["resume"] = saved === undefined || duration === undefined || saved.positionSeconds === 0 ? { kind: "start" } : saved.positionSeconds >= duration ? { kind: "reached-end" } : { kind: "position", positionSeconds: saved.positionSeconds };
      return { ...candidate, resume };
    }) };
  } catch { return { ok: false, error: { code: "dependency_unavailable" } }; }
}
