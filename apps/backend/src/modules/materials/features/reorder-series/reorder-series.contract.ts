import type {
  ForbiddenError,
  InvalidContentError,
  InvalidReferenceError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { SeriesNotFoundError } from "../load-series-order/load-series-order.contract.js";
import type { Result } from "../../result.js";

export interface ReorderSeriesCommand {
  readonly actor: string;
  readonly expectedOrderVersion: string;
  readonly orderedMaterialIds: readonly string[];
  readonly seriesId: string;
}

export interface ReorderSeriesReceiptDto {
  readonly orderVersion: string;
  readonly seriesId: string;
}

export type StaleSeriesOrderError = {
  readonly code: "stale_series_order";
  readonly currentOrderVersion: string;
};
export type ReorderSeriesError =
  | ForbiddenError
  | InvalidContentError
  | InvalidReferenceError
  | SeriesNotFoundError
  | StaleSeriesOrderError
  | SystemError;
export type ReorderSeriesResult = Result<
  ReorderSeriesReceiptDto,
  ReorderSeriesError
>;
export type ReorderSeriesOperation = (
  command: ReorderSeriesCommand,
) => Promise<ReorderSeriesResult>;
