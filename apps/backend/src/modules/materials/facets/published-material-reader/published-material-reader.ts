import type { ListPublishedSiteMaterialsOperation } from "../../features/list-published-site-materials/list-published-site-materials.contract.js";
import type { ReadHomeProjectionsOperation } from "../../features/read-home-projections/read-home-projections.contract.js";
import type { ReadHomePinnedProductOperation } from "../../features/read-home-pinned-product/read-home-pinned-product.js";
import type { ListPublishedMaterialProjectionsOperation } from "../../features/list-published-material-projections/list-published-material-projections.contract.js";
import type { DiscoverPublishedMaterialProjectionsOperation } from "../../features/discover-published-material-projections/discover-published-material-projections.contract.js";
import type { ReadPublishedMaterialOperation } from "../../features/read-published-material/read-published-material.contract.js";

export interface PublishedMaterialReader {
  readonly listSiteMaterials: ListPublishedSiteMaterialsOperation;
  readonly readHomeProjections: ReadHomeProjectionsOperation;
  readonly readHomePinnedProduct: ReadHomePinnedProductOperation;
  readonly discoverProjections: DiscoverPublishedMaterialProjectionsOperation;
  readonly listProjections: ListPublishedMaterialProjectionsOperation;
  readonly read: ReadPublishedMaterialOperation;
}

export const PUBLISHED_MATERIAL_READER = Symbol("PUBLISHED_MATERIAL_READER");
