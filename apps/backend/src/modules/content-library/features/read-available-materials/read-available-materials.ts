import type { ContentAccess, Subject } from "../../../content-access/index.js";
import type { PublishedMaterialSelection } from "../../../materials/index.js";
import type { Videos } from "../../../videos/index.js";
import { projectPublishedCatalogItems } from "../../shared/project-published-catalog-items.js";

/** Published discovery and current body access own admission to personal Home. */
export async function readAvailableMaterials(dependencies: {
  readonly selection: Pick<PublishedMaterialSelection, "read">;
  readonly contentAccess: Pick<ContentAccess, "checkAvailabilityMany">;
  readonly videos: Pick<Videos, "loadReadyDurations">;
}, subject: Subject, materialIds: readonly string[]) {
  const selected = await dependencies.selection.read(materialIds);
  if (!selected.ok) return { ok: false as const, error: { code: "dependency_unavailable" as const } };
  const projected = await projectPublishedCatalogItems(dependencies.contentAccess, {
    loadReadyDurations: async (ids) => {
      try {
        const result = await dependencies.videos.loadReadyDurations(ids);
        return result.ok ? result : { ok: true as const, value: [] };
      } catch { return { ok: true as const, value: [] }; }
    },
  }, subject, selected.value);
  return projected.ok ? { ok: true as const, value: projected.items.filter((item) => item.availability === "available") } : { ok: false as const, error: { code: "dependency_unavailable" as const } };
}
