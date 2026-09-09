import type {
  ForbiddenError,
  InvalidContentError,
  InvalidReferenceError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { GuideChapterDraft } from "../../shared/guide-chapters.js";
import type { SeriesNotFoundError } from "../load-series-order/load-series-order.contract.js";
import type { Result } from "../../result.js";

export interface ReorderSeriesCommand {
  readonly actor: string;
  /** The complete ordered chapter list; omitted keeps the current chapters unchanged. */
  readonly chapters?: readonly GuideChapterDraft[] | undefined;
  /** Material to chapter placement; omitted keeps the placement of retained Materials. */
  readonly chapterAssignments?: Readonly<Record<string, string>> | undefined;
  readonly expectedOrderVersion: string;
  readonly orderedMaterialIds: readonly string[];
  readonly stepGroups?: Readonly<Record<string, string>> | undefined;
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
