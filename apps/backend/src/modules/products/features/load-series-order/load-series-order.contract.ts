import type { ProductProgrammePlacement } from "../../shared/product-chapters.js";
type PublicationState = "draft" | "published" | "unpublished";
import type {
  ForbiddenError,
  SystemError,
} from "../../../../infrastructure/content-authoring/authoring-errors.js";
import type { Result } from "../../../../infrastructure/content-authoring/result.js";

export interface ProductChapterDto {
  readonly supplementaryMaterialIds?: readonly string[];
  readonly id: string;
  readonly name: string;
  readonly ordinal: number;
  readonly summary: string;
}

export interface SeriesOrderMaterialDto {
  readonly chapterId: string | null;
  readonly materialId: string;
  readonly ordinal: number;
  readonly stepGroup: string | null;
  readonly publicationState: PublicationState;
  readonly title: string | null;
}

export interface SeriesOrderDto {
  readonly programmePlacements: readonly ProductProgrammePlacement[];
  readonly archived: boolean;
  readonly chapters: readonly ProductChapterDto[];
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
  ForbiddenError | SeriesNotFoundError | SystemError;
export type LoadSeriesOrderResult = Result<
  SeriesOrderDto,
  LoadSeriesOrderError
>;
export type LoadSeriesOrderOperation = (
  query: LoadSeriesOrderQuery,
) => Promise<LoadSeriesOrderResult>;
