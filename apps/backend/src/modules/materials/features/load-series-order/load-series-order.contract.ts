import type { PublicationState } from "../../domain/material.js";
import type {
  ForbiddenError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export interface SeriesOrderMaterialDto {
  readonly materialId: string;
  readonly ordinal: number;
  readonly publicationState: PublicationState;
  readonly title: string | null;
}

export interface AvailableSeriesMaterialDto {
  readonly materialId: string;
  readonly publicationState: PublicationState;
  readonly title: string | null;
}

export interface SeriesOrderDto {
  readonly archived: boolean;
  readonly availableMaterials: readonly AvailableSeriesMaterialDto[];
  readonly items: readonly SeriesOrderMaterialDto[];
  readonly name: string;
  readonly orderVersion: string;
  readonly seriesId: string;
}

export interface LoadSeriesOrderQuery {
  readonly actor: string;
  readonly seriesId: string;
}

export type SeriesNotFoundError = { readonly code: "series_not_found" };
export type LoadSeriesOrderError =
  | ForbiddenError
  | SeriesNotFoundError
  | SystemError;
export type LoadSeriesOrderResult = Result<SeriesOrderDto, LoadSeriesOrderError>;
export type LoadSeriesOrderOperation = (
  query: LoadSeriesOrderQuery,
) => Promise<LoadSeriesOrderResult>;
