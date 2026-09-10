import type { ContentAccess, Subject } from "../../../content-access/index.js";
import type { PublishedMaterialSelection } from "../../../materials/index.js";
import type { Videos } from "../../../videos/index.js";
import { projectPublishedCatalogItems, type PublishedCatalogItemsResult } from "../../shared/project-published-catalog-items.js";

export interface PublishedCatalogDependencies {
  readonly selection: Pick<PublishedMaterialSelection, "read">;
  readonly contentAccess: Pick<ContentAccess, "checkAvailabilityMany">;
  readonly videos: Pick<Videos, "loadReadyDurations">;
}

/** Safe published projections for a bounded set of Material IDs, including locked items. */
export function readPublishedCatalogItems(
  dependencies: PublishedCatalogDependencies,
  subject: Subject,
  materialIds: readonly string[],
): Promise<PublishedCatalogItemsResult> {
  return readProjections(dependencies, subject, materialIds);
}

/** Published discovery and current body access own admission to personal Home. */
export async function readAvailableMaterials(
  dependencies: PublishedCatalogDependencies,
  subject: Subject,
  materialIds: readonly string[],
) {
  const projected = await readProjections(dependencies, subject, materialIds);
  return projected.ok
    ? { ok: true as const, value: projected.items.filter((item) => item.availability === "available") }
    : { ok: false as const, error: { code: "dependency_unavailable" as const } };
}

async function readProjections(
  dependencies: PublishedCatalogDependencies,
  subject: Subject,
  materialIds: readonly string[],
): Promise<PublishedCatalogItemsResult> {
  const selected = await dependencies.selection.read(materialIds);
  if (!selected.ok) return { ok: false, error: { code: "dependency_unavailable", retryable: true } };
  return projectPublishedCatalogItems(dependencies.contentAccess, {
    loadReadyDurations: async (ids) => {
      try {
        const result = await dependencies.videos.loadReadyDurations(ids);
        return result.ok ? result : { ok: true as const, value: [] };
      } catch { return { ok: true as const, value: [] }; }
    },
  }, subject, selected.value);
}
