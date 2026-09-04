import type { ContentAccess, Subject } from "../../../content-access/index.js";
import type { PublishedMaterialReader } from "../../../materials/index.js";
import type { Videos } from "../../../videos/index.js";
import type {
  PublishedMaterialCatalogFacetDto,
  PublishedMaterialCatalogItemDto,
  PublishedMaterialCatalogResult,
} from "../list-published-materials/list-published-materials.contract.js";
import { listPublishedMaterials } from "../list-published-materials/list-published-materials.js";

export interface HomeContentDto {
  readonly topics: readonly PublishedMaterialCatalogFacetDto[];
  readonly playlists: readonly PublishedMaterialCatalogFacetDto[];
  readonly videos: readonly PublishedMaterialCatalogItemDto[];
  readonly guides: readonly PublishedMaterialCatalogItemDto[];
  readonly notes: readonly PublishedMaterialCatalogItemDto[];
}

export type HomeContentResult =
  | Readonly<{ ok: true; value: HomeContentDto }>
  | Extract<PublishedMaterialCatalogResult, { ok: false }>;

const HOME_MATERIAL_LIMIT = 8;

export async function readHomeContent(
  publishedMaterialReader: Pick<PublishedMaterialReader, "listProjections">,
  contentAccess: Pick<ContentAccess, "checkAvailabilityMany">,
  videoCatalog: Pick<Videos, "loadReadyDurations">,
  subject: Subject,
): Promise<HomeContentResult> {
  const [catalog, videos, guides, notes] = await Promise.all([
    listPublishedMaterials(publishedMaterialReader, contentAccess, videoCatalog, {
      first: 1,
      subject,
      sort: "newest",
    }),
    listPublishedMaterials(publishedMaterialReader, contentAccess, videoCatalog, {
      first: HOME_MATERIAL_LIMIT,
      formatSlugs: ["video"],
      subject,
      sort: "newest",
    }),
    listPublishedMaterials(publishedMaterialReader, contentAccess, videoCatalog, {
      first: HOME_MATERIAL_LIMIT,
      formatSlugs: ["guide"],
      subject,
      sort: "newest",
    }),
    listPublishedMaterials(publishedMaterialReader, contentAccess, videoCatalog, {
      first: HOME_MATERIAL_LIMIT,
      formatSlugs: ["note"],
      subject,
      sort: "newest",
    }),
  ]);
  for (const result of [catalog, videos, guides, notes]) {
    if (!result.ok) return result;
  }
  if (!catalog.ok || !videos.ok || !guides.ok || !notes.ok) {
    throw new TypeError("Home content result narrowing failed");
  }
  return {
    ok: true,
    value: {
      topics: catalog.value.facets.topics.slice(0, 8),
      playlists: catalog.value.facets.series.slice(0, 4),
      videos: videos.value.items,
      guides: guides.value.items,
      notes: notes.value.items,
    },
  };
}
