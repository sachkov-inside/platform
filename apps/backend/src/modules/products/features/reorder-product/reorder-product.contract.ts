import type {
  ForbiddenError,
  ProductRemovalConfirmationRequiredError,
  InvalidContentError,
  InvalidReferenceError,
  SystemError,
} from "../../../../infrastructure/content-authoring/authoring-errors.js";
import type { ProductProgrammePlacement } from "../../shared/product-chapters.js";
import type { ProductChapterDraft } from "../../shared/product-chapters.js";
import type { ProductNotFoundError } from "../load-product-order/load-product-order.contract.js";
import type { Result } from "../../../../infrastructure/content-authoring/result.js";

export interface ReorderProductCommand {
  /** The complete programme. Omitted preserves retained occurrences and their identities. */
  readonly programmePlacements?:
    readonly ProductProgrammePlacement[] | undefined;
  readonly actor: string;
  /** The complete ordered chapter list; omitted keeps the current chapters unchanged. */
  readonly chapters?: readonly ProductChapterDraft[] | undefined;
  /** Material to chapter placement; omitted keeps the placement of retained Materials. */
  readonly chapterAssignments?: Readonly<Record<string, string>> | undefined;
  readonly expectedOrderVersion: string;
  /** Complete catalogue membership; its order does not create or reorder programme positions. */
  readonly orderedMaterialIds: readonly string[];
  readonly stepGroups?: Readonly<Record<string, string>> | undefined;
  readonly productId: string;
  /** Подтверждённое снятие опубликованных материалов из руководства с держателями права. */
  readonly confirmedProductRemovals?: readonly string[] | undefined;
}

export interface ReorderProductReceiptDto {
  readonly orderVersion: string;
  readonly productId: string;
}

export type StaleProductOrderError = {
  readonly code: "stale_product_order";
  readonly currentOrderVersion: string;
};
export type ReorderProductError =
  | ForbiddenError
  | ProductRemovalConfirmationRequiredError
  | InvalidContentError
  | InvalidReferenceError
  | ProductNotFoundError
  | StaleProductOrderError
  | SystemError;
export type ReorderProductResult = Result<
  ReorderProductReceiptDto,
  ReorderProductError
>;
export type ReorderProductOperation = (
  command: ReorderProductCommand,
) => Promise<ReorderProductResult>;
