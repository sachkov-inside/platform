import type {
  ProductDiscovery,
  ProductCompositionsReading,
} from "../../../products/index.js";
import { assembleListPublishedSiteMaterials } from "../../features/list-published-site-materials/list-published-site-materials.js";
import { readHomeProjections } from "../../features/read-home-projections/read-home-projections.js";
import { readHomePinnedProduct } from "../../features/read-home-pinned-product/read-home-pinned-product.js";
import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { listPublishedMaterialProjections } from "../../features/list-published-material-projections/list-published-material-projections.js";
import type { ListPublishedMaterialProjectionsQuery } from "../../features/list-published-material-projections/list-published-material-projections.contract.js";
import type { MaterialBodyOperations } from "../../domain/material-body/material-body.js";
import type { ContentAccess } from "../../../content-access/index.js";
import type { MaterialContent } from "../material-content/material-content.js";
import type { PublishedMaterialReader } from "./published-material-reader.js";
import { readPublishedMaterial } from "../../features/read-published-material/read-published-material.js";
import type { ReadPublishedMaterialQuery } from "../../features/read-published-material/read-published-material.contract.js";
import { discoverPublishedMaterialProjections } from "../../features/discover-published-material-projections/discover-published-material-projections.js";
import type { DiscoverPublishedMaterialProjectionsQuery } from "../../features/discover-published-material-projections/discover-published-material-projections.contract.js";
import type { MaterialAssets } from "../../../assets/index.js";
import type { Videos } from "../../../videos/index.js";

export function assemblePublishedMaterialReader(dependencies: {
  readonly prisma: MaterialsPrismaClient;
  readonly products: Pick<
    ProductDiscovery,
    "snapshot" | "homePin" | "siteCandidates"
  >;
  readonly compositions: Pick<ProductCompositionsReading, "load">;
  readonly contentAccess: ContentAccess;
  readonly materialContent: MaterialContent;
  readonly materialBodyOperations: MaterialBodyOperations;
  /** Предлагается ли подписка этому Account; гостю — без Account. */
  readonly subscriptionForSale?: (accountId?: string) => Promise<boolean>;
  readonly materialAssets?: Pick<MaterialAssets, "loadPresentations">;
  readonly videos?: Pick<Videos, "loadPresentation">;
}): PublishedMaterialReader {
  return Object.freeze({
    listSiteMaterials: assembleListPublishedSiteMaterials(
      dependencies.prisma,
      dependencies.products,
    ),
    readHomeProjections: () => readHomeProjections(dependencies),
    readHomePinnedProduct: () => readHomePinnedProduct(dependencies.products),
    discoverProjections: (query: DiscoverPublishedMaterialProjectionsQuery) =>
      discoverPublishedMaterialProjections(
        dependencies,
        query,
        dependencies.contentAccess,
      ),
    listProjections: (query: ListPublishedMaterialProjectionsQuery) =>
      listPublishedMaterialProjections(dependencies, query),
    read: (query: ReadPublishedMaterialQuery) =>
      readPublishedMaterial(dependencies, query),
  });
}
