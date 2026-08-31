import type { ListPublishedMaterialProjectionsOperation } from "../../features/list-published-material-projections/list-published-material-projections.contract.js";
import type { DiscoverPublishedMaterialProjectionsOperation } from "../../features/discover-published-material-projections/discover-published-material-projections.contract.js";
import type { ReadPublishedMaterialOperation } from "../../features/read-published-material/read-published-material.contract.js";

export interface PublishedMaterialReader {
  readonly discoverProjections: DiscoverPublishedMaterialProjectionsOperation;
  readonly listProjections: ListPublishedMaterialProjectionsOperation;
  readonly read: ReadPublishedMaterialOperation;
}

export const PUBLISHED_MATERIAL_READER = Symbol("PUBLISHED_MATERIAL_READER");
