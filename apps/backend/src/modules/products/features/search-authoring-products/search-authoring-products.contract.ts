import type {
  ForbiddenError,
  SystemError,
} from "../../../../infrastructure/content-authoring/authoring-errors.js";
import type { Result } from "../../../../infrastructure/content-authoring/result.js";

/** One search of Products for the authoring search (#1720): the text and the most hits to return. */
export interface SearchAuthoringProductsQuery {
  readonly actor: string;
  /** Trimmed, 1–160 characters; whitespace runs count as one space. */
  readonly query: string;
  /** At most 20. */
  readonly limit: number;
}

/** A Product found by its name or slug; an archived Product is found too and flagged. */
export interface AuthoringProductHitDto {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
}

export type SearchAuthoringProductsError = ForbiddenError | SystemError;

/** Products by name ascending, then id. Requires `materials:manage`. */
export type SearchAuthoringProductsOperation = (
  query: SearchAuthoringProductsQuery,
) => Promise<
  Result<readonly AuthoringProductHitDto[], SearchAuthoringProductsError>
>;
