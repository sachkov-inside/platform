import type { MaterialBodyExtraction } from "../../domain/material-body/material-body.js";
import type {
  ForbiddenError,
  InvalidContentError,
  InvalidReferenceError,
  MaterialNotFoundError,
  RevisionNotFoundError,
  SeriesOrdinalConflictError,
  StaleRevisionError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export interface ValidateRevisionQuery {
  readonly actor: string;
  readonly materialId: string;
  readonly revisionId: string;
}

export interface ValidatedRevisionDto {
  readonly materialId: string;
  readonly revisionId: string;
  readonly projectionDigest: string;
  readonly extraction: MaterialBodyExtraction;
}

export type ValidateRevisionError =
  | InvalidContentError
  | ForbiddenError
  | MaterialNotFoundError
  | RevisionNotFoundError
  | StaleRevisionError
  | InvalidReferenceError
  | SeriesOrdinalConflictError
  | SystemError;
export type ValidateRevisionResult = Result<
  ValidatedRevisionDto,
  ValidateRevisionError
>;
export type ValidateRevisionOperation = (
  query: ValidateRevisionQuery,
) => Promise<ValidateRevisionResult>;
