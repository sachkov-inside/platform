import type { PublishedMaterialProjectionDto } from "../../facets/published-material-reader/published-material.contract.js";
import type { PublishedMaterialFacetOptionDto } from "../list-published-material-projections/list-published-material-projections.contract.js";
import type { HomePinnedSeries } from "../read-home-pinned-series/read-home-pinned-series.js";
import type { SystemError } from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export interface HomeProjections {
  readonly topics: readonly PublishedMaterialFacetOptionDto[];
  readonly playlists: readonly PublishedMaterialFacetOptionDto[];
  readonly pinnedSeries:
    (PublishedMaterialFacetOptionDto & HomePinnedSeries) | null;
  readonly videos: readonly PublishedMaterialProjectionDto[];
  readonly guides: readonly PublishedMaterialProjectionDto[];
  readonly notes: readonly PublishedMaterialProjectionDto[];
}

export type ReadHomeProjectionsOperation = () => Promise<
  Result<HomeProjections, SystemError>
>;
