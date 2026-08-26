import type { ListPublishedMaterialProjectionsOperation } from "../../features/list-published-material-projections/list-published-material-projections.contract.js";
import type { ReadPublishedMaterialOperation } from "../../features/read-published-material/read-published-material.contract.js";

export interface PublishedMaterialReader {
  readonly listProjections: ListPublishedMaterialProjectionsOperation;
  readonly read: ReadPublishedMaterialOperation;
}

export const PUBLISHED_MATERIAL_READER = Symbol("PUBLISHED_MATERIAL_READER");
