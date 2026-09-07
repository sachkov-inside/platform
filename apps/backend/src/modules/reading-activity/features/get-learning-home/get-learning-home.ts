import { z } from "zod";
import { accountId } from "../../../accounts/index.js";
import { readAvailableMaterials } from "../../../content-library/index.js";
import type { PublishedMaterialSelection } from "../../../materials/index.js";
import type { ContinueMaterial } from "../get-continue-materials/get-continue-materials.js";
import { getSeriesContinuation, type SeriesContinuation, type SeriesContinuationDependencies } from "../get-series-continuation/get-series-continuation.js";
import { loadMaterialResumes } from "../../shared/load-material-resumes.js";

const MAX_RECENT_VISITS = 500;
const MATERIAL_BATCH_SIZE = 100;
const MAX_RECENT_SERIES = 10;
export interface LearningHome { readonly video: ContinueMaterial | null; readonly series: SeriesContinuation | null }
export type LearningHomeResult = { readonly ok: true; readonly value: LearningHome } | { readonly ok: false; readonly error: { readonly code: "invalid_request" | "dependency_unavailable" } };

export async function getLearningHome(dependencies: SeriesContinuationDependencies & { readonly selection: Pick<PublishedMaterialSelection, "read"> }, account: string): Promise<LearningHomeResult> {
  if (!z.uuid().safeParse(account).success) return { ok: false, error: { code: "invalid_request" } };
  try {
    const subject = { kind: "account" as const, accountId: accountId(account) };
    const visits = await dependencies.prisma.readingMaterialVisit.findMany({ where: { accountId: account }, orderBy: [{ lastOpenedAt: "desc" }, { materialId: "asc" }], take: MAX_RECENT_VISITS });
    const seriesSlugs = new Set<string>();
    let video: ContinueMaterial | null = null;
    for (let offset = 0; offset < visits.length; offset += MATERIAL_BATCH_SIZE) {
      const batch = visits.slice(offset, offset + MATERIAL_BATCH_SIZE);
      const materials = await readAvailableMaterials(dependencies, subject, batch.map((visit) => visit.materialId));
      if (!materials.ok) return materials;
      const byId = new Map(materials.value.map((item) => [item.materialId, item]));
      for (const visit of batch) {
        for (const membership of byId.get(visit.materialId)?.seriesMemberships ?? []) {
          if (seriesSlugs.size < MAX_RECENT_SERIES) seriesSlugs.add(membership.series.slug);
        }
      }
      if (video !== null) continue;
      const states = await dependencies.prisma.readingMaterialState.findMany({ where: { accountId: account, materialId: { in: batch.map((visit) => visit.materialId) }, isRead: true }, select: { materialId: true } });
      const read = new Set(states.map((item) => item.materialId));
      const candidates = materials.value.filter((item) => item.format.slug === "video" && !read.has(item.materialId));
      const resumes = await loadMaterialResumes(dependencies, subject, candidates);
      for (const visit of batch) {
        const resume = resumes.get(visit.materialId);
        const material = byId.get(visit.materialId);
        if (resume?.kind === "position" && material !== undefined) { video = { material, lastOpenedAt: visit.lastOpenedAt.toISOString(), resume }; break; }
      }
    }
    for (const slug of seriesSlugs) {
      const series = await getSeriesContinuation(dependencies, account, slug);
      if (!series.ok) {
        if (series.error.code === "series_not_found") continue;
        return { ok: false, error: { code: "dependency_unavailable" } };
      }
      if (series.value.continuation !== null) return { ok: true, value: { video, series: series.value } };
    }
    return { ok: true, value: { video, series: null } };
  } catch { return { ok: false, error: { code: "dependency_unavailable" } }; }
}
