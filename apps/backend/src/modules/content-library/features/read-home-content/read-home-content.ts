import type { ContentAccess, Subject } from "../../../content-access/index.js";
import type {
  GuidePageCard,
  PublishedMaterialReader,
} from "../../../materials/index.js";
import type { Videos } from "../../../videos/index.js";
import type { MembershipEntitlements } from "../../../membership-entitlements/index.js";
import type {
  PublishedMaterialCatalogFacetDto,
  PublishedMaterialCatalogItemDto,
  PublishedMaterialCatalogResult,
} from "../list-published-materials/list-published-materials.contract.js";
import { listPublishedMaterials } from "../list-published-materials/list-published-materials.js";

/** Закреплённый продукт с оформлением его карточки (ADR 0026). */
export interface HomePinnedSeriesDto extends PublishedMaterialCatalogFacetDto {
  readonly presentation: string;
  readonly card: GuidePageCard | null;
}

export interface HomeContentDto {
  readonly pinnedSeries: HomePinnedSeriesDto | null;
  readonly topics: readonly PublishedMaterialCatalogFacetDto[];
  readonly playlists: readonly PublishedMaterialCatalogFacetDto[];
  readonly videos: readonly PublishedMaterialCatalogItemDto[];
  readonly guides: readonly PublishedMaterialCatalogItemDto[];
  readonly notes: readonly PublishedMaterialCatalogItemDto[];
  readonly membership:
    | Readonly<{ kind: "active" }>
    | Readonly<{ kind: "inactive" }>
    | Readonly<{ kind: "notOffered" }>
    | Readonly<{ kind: "unknown" }>;
}

export type HomeContentResult =
  | Readonly<{ ok: true; value: HomeContentDto }>
  | Extract<PublishedMaterialCatalogResult, { ok: false }>;

const HOME_MATERIAL_LIMIT = 8;

export async function readHomeContent(
  publishedMaterialReader: Pick<
    PublishedMaterialReader,
    "listProjections" | "readHomePinnedSeries"
  >,
  contentAccess: Pick<ContentAccess, "checkAvailabilityMany">,
  videoCatalog: Pick<Videos, "loadReadyDurations">,
  membershipEntitlements: Pick<MembershipEntitlements, "resolveForAccess">,
  subscriptionForSale: boolean,
  subject: Subject,
): Promise<HomeContentResult> {
  const [catalog, videos, guides, notes, pin, membership] = await Promise.all([
    listPublishedMaterials(
      publishedMaterialReader,
      contentAccess,
      videoCatalog,
      {
        first: 1,
        subject,
        sort: "newest",
      },
    ),
    listPublishedMaterials(
      publishedMaterialReader,
      contentAccess,
      videoCatalog,
      {
        first: HOME_MATERIAL_LIMIT,
        formatSlugs: ["video"],
        subject,
        sort: "newest",
      },
    ),
    listPublishedMaterials(
      publishedMaterialReader,
      contentAccess,
      videoCatalog,
      {
        first: HOME_MATERIAL_LIMIT,
        formatSlugs: ["guide"],
        subject,
        sort: "newest",
      },
    ),
    listPublishedMaterials(
      publishedMaterialReader,
      contentAccess,
      videoCatalog,
      {
        first: HOME_MATERIAL_LIMIT,
        formatSlugs: ["note"],
        subject,
        sort: "newest",
      },
    ),
    publishedMaterialReader.readHomePinnedSeries(),
    resolveHomeMembership(membershipEntitlements, subscriptionForSale, subject),
  ]);
  for (const result of [catalog, videos, guides, notes]) {
    if (!result.ok) return result;
  }
  if (!catalog.ok || !videos.ok || !guides.ok || !notes.ok) {
    throw new TypeError("Home content result narrowing failed");
  }
  if (!pin.ok) return pin;
  const pinnedFacet =
    pin.value === null
      ? undefined
      : catalog.value.facets.series.find(
          (series) => series.id === pin.value?.id && series.count > 0,
        );
  return {
    ok: true,
    value: {
      pinnedSeries:
        pin.value === null || pinnedFacet === undefined
          ? null
          : {
              id: pinnedFacet.id,
              slug: pinnedFacet.slug,
              name: pinnedFacet.name,
              summary: pinnedFacet.summary,
              count: pinnedFacet.count,
              cover: pinnedFacet.cover,
              previewItems: pinnedFacet.previewItems,
              presentation: pin.value.presentation,
              card: pin.value.card,
            },
      topics: catalog.value.facets.topics.slice(0, 8),
      playlists: catalog.value.facets.series.slice(0, 4),
      videos: videos.value.items,
      guides: guides.value.items,
      notes: notes.value.items,
      membership,
    },
  };
}

async function resolveHomeMembership(
  membershipEntitlements: Pick<MembershipEntitlements, "resolveForAccess">,
  subscriptionForSale: boolean,
  subject: Subject,
): Promise<HomeContentDto["membership"]> {
  if (subject.kind === "anonymous") {
    return subscriptionForSale ? { kind: "inactive" } : { kind: "notOffered" };
  }
  const state = await membershipEntitlements.resolveForAccess(
    subject.accountId,
  );
  if (state.kind === "active") return { kind: "active" };
  return state.kind === "required" || state.kind === "expired"
    ? subscriptionForSale
      ? { kind: "inactive" }
      : { kind: "notOffered" }
    : { kind: "unknown" };
}
