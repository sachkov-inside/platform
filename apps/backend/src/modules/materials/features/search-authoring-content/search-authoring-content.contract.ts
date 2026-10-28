import type { PublicationState } from "../../domain/material.js";
import type {
  ForbiddenError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

/** One search of the authoring corpus: the text and the most hits to return. */
export interface SearchAuthoringContentQuery {
  readonly actor: string;
  /** Trimmed, 1–160 characters; whitespace runs count as one space. */
  readonly query: string;
  /** At most 20. */
  readonly limit: number;
}

/** A Material found as the authoring list finds it: by title, summary or slug. */
export interface AuthoringMaterialHitDto {
  readonly id: string;
  readonly title: string | null;
  readonly publicationState: PublicationState;
  /** The Topic name; `null` when the Material has no Topic yet. */
  readonly topic: string | null;
}

export type SearchAuthoringContentError = ForbiddenError | SystemError;

/** Materials most recently changed first, then by id descending. Requires `materials:manage`. */
export type SearchAuthoringMaterialsOperation = (
  query: SearchAuthoringContentQuery,
) => Promise<
  Result<readonly AuthoringMaterialHitDto[], SearchAuthoringContentError>
>;
