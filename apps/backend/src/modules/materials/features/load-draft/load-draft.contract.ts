import type {
  ForbiddenError,
  InvalidContentError,
  MaterialNotFoundError,
  MaterialRevisionDto,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export interface LoadDraftQuery {
  readonly actor: string;
  readonly materialId: string;
}

export type LoadDraftError =
  | InvalidContentError
  | ForbiddenError
  | MaterialNotFoundError
  | SystemError;
export type LoadDraftResult = Result<MaterialRevisionDto, LoadDraftError>;
export type LoadDraftOperation = (
  query: LoadDraftQuery,
) => Promise<LoadDraftResult>;
