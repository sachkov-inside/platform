import type {
  DraftDeletionForbiddenError,
  ForbiddenError,
  IdempotencyError,
  InvalidContentError,
  InvalidReferenceError,
  MaterialNotFoundError,
  StaleContentVersionError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export interface DeleteDraftCommand {
  readonly actor: string;
  readonly idempotencyKey: string;
  readonly materialId: string;
  readonly expectedContentVersion: number;
  readonly deleteVideoId?: string | null;
}

export type DeleteDraftError =
  | InvalidContentError
  | ForbiddenError
  | MaterialNotFoundError
  | InvalidReferenceError
  | StaleContentVersionError
  | DraftDeletionForbiddenError
  | IdempotencyError
  | SystemError;
export type DeleteDraftResult = Result<
  { readonly materialId: string },
  DeleteDraftError
>;
export type DeleteDraftOperation = (
  command: DeleteDraftCommand,
) => Promise<DeleteDraftResult>;
