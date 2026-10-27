import type { PublishedMaterialProjectionDto } from "../../facets/published-material-reader/published-material.contract.js";
import type { PublishedMaterialFacetOptionDto } from "../list-published-material-projections/list-published-material-projections.contract.js";
import type { HomePinnedProduct } from "../read-home-pinned-product/read-home-pinned-product.js";
import type { SystemError } from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export interface HomeProjections {
  readonly topics: readonly PublishedMaterialFacetOptionDto[];
  readonly playlists: readonly PublishedMaterialFacetOptionDto[];
  readonly pinnedProduct:
    (PublishedMaterialFacetOptionDto & HomePinnedProduct) | null;
  readonly videos: readonly PublishedMaterialProjectionDto[];
  readonly guides: readonly PublishedMaterialProjectionDto[];
  readonly notes: readonly PublishedMaterialProjectionDto[];
}

export type ReadHomeProjectionsOperation = () => Promise<
  Result<HomeProjections, SystemError>
>;
