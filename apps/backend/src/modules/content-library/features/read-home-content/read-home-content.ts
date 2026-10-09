import { z } from "zod";
import { projectPublishedCatalogItems } from "../../shared/project-published-catalog-items.js";
import type { ContentAccess, Subject } from "../../../content-access/index.js";
import type {
  ProductPageCard,
  ProductPageHero,
  PublishedMaterialReader,
  PublishedMaterialProjectionDto,
} from "../../../materials/index.js";
import type { Videos } from "../../../videos/index.js";
import type { AccountRights } from "../../../account-rights/index.js";
import type {
  PublishedMaterialCatalogFacetDto,
  PublishedMaterialCatalogItemDto,
  PublishedMaterialCatalogResult,
} from "../list-published-materials/list-published-materials.contract.js";

/** Закреплённый продукт с оформлением его карточки (ADR 0026). */
export interface HomePinnedSeriesDto extends PublishedMaterialCatalogFacetDto {
  readonly presentation: string;
  readonly card: ProductPageCard | null;
  readonly hero: ProductPageHero | null;
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

const subjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("anonymous") }).strict(),
  z.object({ kind: z.literal("account"), accountId: z.uuid() }).strict(),
]);

export async function readHomeContent(
  publishedMaterialReader: Pick<PublishedMaterialReader, "readHomeProjections">,
  contentAccess: Pick<ContentAccess, "checkAvailabilityMany">,
  videoCatalog: Pick<Videos, "loadReadyDurations">,
  accountRights: Pick<AccountRights, "resolveForAccess">,
  subscriptionForSale: boolean,
  subject: Subject,
): Promise<HomeContentResult> {
  if (!subjectSchema.safeParse(subject).success) {
    return { ok: false, error: { code: "invalid_request_shape" } };
  }
  const [home, membership] = await Promise.all([
    publishedMaterialReader.readHomeProjections(),
    resolveHomeMembership(accountRights, subscriptionForSale, subject),
  ]);
  if (!home.ok) return home;
  const projections = [
    ...new Map(
      [
        ...home.value.videos,
        ...home.value.guides,
        ...home.value.notes,
        ...home.value.playlists.flatMap(({ previewItems }) => previewItems),
        ...(home.value.pinnedSeries?.previewItems ?? []),
      ].map((item) => [item.materialId, item]),
    ).values(),
  ];
  const projected = await projectPublishedCatalogItems(
    contentAccess,
    videoCatalog,
    subject,
    projections,
  );
  if (!projected.ok) return projected;
  const byId = new Map(projected.items.map((item) => [item.materialId, item]));
  const items = (values: readonly PublishedMaterialProjectionDto[]) =>
    values.flatMap(({ materialId }) => {
      const item = byId.get(materialId);
      return item === undefined ? [] : [item];
    });
  const facet = (value: (typeof home.value.playlists)[number]) => ({
    id: value.id,
    slug: value.slug,
    name: value.name,
    summary: value.summary,
    count: value.count,
    cover: value.cover,
    previewItems: items(value.previewItems),
  });
  const pin = home.value.pinnedSeries;
  return {
    ok: true,
    value: {
      pinnedSeries:
        pin === null
          ? null
          : {
              id: pin.id,
              slug: pin.slug,
              name: pin.name,
              summary: pin.summary,
              count: pin.count,
              cover: pin.cover,
              previewItems: items(pin.previewItems),
              presentation: pin.presentation,
              card: pin.card,
              hero: pin.hero,
            },
      topics: home.value.topics.map(facet),
      playlists: home.value.playlists.map(facet),
      videos: items(home.value.videos),
      guides: items(home.value.guides),
      notes: items(home.value.notes),
      membership,
    },
  };
}

async function resolveHomeMembership(
  accountRights: Pick<AccountRights, "resolveForAccess">,
  subscriptionForSale: boolean,
  subject: Subject,
): Promise<HomeContentDto["membership"]> {
  if (subject.kind === "anonymous") {
    return subscriptionForSale ? { kind: "inactive" } : { kind: "notOffered" };
  }
  const state = await accountRights.resolveForAccess(subject.accountId);
  if (state.kind === "active") return { kind: "active" };
  return state.kind === "required" || state.kind === "expired"
    ? subscriptionForSale
      ? { kind: "inactive" }
      : { kind: "notOffered" }
    : { kind: "unknown" };
}
