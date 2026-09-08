import { z } from "zod";
import type { ReadingActivityPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { accountId } from "../../../accounts/index.js";
import type { ContentAccess } from "../../../content-access/index.js";
import { discoverPublishedMaterials, type PublishedMaterialCatalogFacetDto } from "../../../content-library/index.js";
import type { PublishedMaterialReader, PublishedSeriesComposition } from "../../../materials/index.js";
import type { Videos } from "../../../videos/index.js";
import type { ContinueMaterial } from "../get-continue-materials/get-continue-materials.js";
import { loadMaterialResumes } from "../../shared/load-material-resumes.js";

export interface SeriesContinuation {
  readonly collection: PublishedMaterialCatalogFacetDto;
  readonly read: number;
  readonly total: number;
  readonly continuation: { readonly materialSlug: string; readonly resume: ContinueMaterial["resume"] } | null;
}
export interface SeriesContinuationDependencies {
  readonly prisma: ReadingActivityPrismaClient;
  readonly composition: Pick<PublishedSeriesComposition, "read">;
  readonly reader: Pick<PublishedMaterialReader, "discoverProjections">;
  readonly contentAccess: Pick<ContentAccess, "checkAvailabilityMany">;
  readonly videos: Pick<Videos, "loadReadyDurations" | "loadProgressMany">;
}
export type SeriesContinuationResult = { readonly ok: true; readonly value: SeriesContinuation } | { readonly ok: false; readonly error: { readonly code: "invalid_request" | "dependency_unavailable" | "series_not_found" } };
const MAX_SERIES_MATERIALS = 10_000;
const querySchema = z.object({ account: z.uuid(), slug: z.string().min(1).max(120) }).strict();

export async function getSeriesContinuation(dependencies: SeriesContinuationDependencies, account: string, slug: string): Promise<SeriesContinuationResult> {
  if (!querySchema.safeParse({ account, slug }).success) return { ok: false, error: { code: "invalid_request" } };
  try {
    const subject = { kind: "account" as const, accountId: accountId(account) };
    const series = await discoverPublishedMaterials(dependencies.reader, dependencies.contentAccess, {
      loadReadyDurations: async (ids) => {
        try { const result = await dependencies.videos.loadReadyDurations(ids); return result.ok ? result : { ok: true as const, value: [] }; }
        catch { return { ok: true as const, value: [] }; }
      },
    }, { kind: "series", slug, first: MAX_SERIES_MATERIALS, subject });
    if (!series.ok) return { ok: false, error: { code: series.error.code === "discovery_not_found" ? "series_not_found" : "dependency_unavailable" } };
    if (series.value.hasNext) return { ok: false, error: { code: "dependency_unavailable" } };
    const composition = await dependencies.composition.read(series.value.reference.id);
    if (!composition.ok) return { ok: false, error: { code: composition.error.code === "series_not_found" ? "series_not_found" : "dependency_unavailable" } };
    const items = series.value.items;
    const ids = items.map((item) => item.materialId);
    const [states, visited] = await Promise.all([
      dependencies.prisma.readingMaterialState.findMany({ where: { accountId: account, materialId: { in: ids }, isRead: true }, select: { materialId: true } }),
      dependencies.prisma.readingMaterialVisit.findFirst({ where: { accountId: account, materialId: { in: ids } }, orderBy: [{ lastOpenedAt: "desc" }, { materialId: "asc" }], select: { materialId: true } }),
    ]);
    const read = new Set(states.map((item) => item.materialId));
    const lastIndex = items.findIndex((item) => item.materialId === visited?.materialId);
    const availableUnread = (item: (typeof items)[number]) => !read.has(item.materialId) && item.availability === "available";
    // Resume the last visited entry; after completion, advance in the current author order.
    // Wrap only to revisit unfinished entries skipped earlier in the route.
    const next = visited === null ? undefined : items.slice(lastIndex).find(availableUnread) ?? items.slice(0, lastIndex).find(availableUnread);
    const resumes = await loadMaterialResumes(dependencies, subject, next === undefined ? [] : [next]);
    return { ok: true, value: {
      collection: { ...series.value.reference, count: items.length, previewItems: items.slice(0, 3) },
      read: read.size, total: items.length,
      continuation: next === undefined ? null : { materialSlug: next.slug, resume: resumes.get(next.materialId) ?? { kind: "start" } },
    } };
  } catch { return { ok: false, error: { code: "dependency_unavailable" } }; }
}
