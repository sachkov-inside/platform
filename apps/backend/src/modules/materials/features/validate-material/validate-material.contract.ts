import type { MaterialBodyExtraction } from "../../domain/material-body/material-body.js";
import type {
  ForbiddenError,
  InvalidContentError,
  InvalidReferenceError,
  MaterialNotFoundError,
  SeriesOrdinalConflictError,
  StaleContentVersionError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export interface ValidateMaterialQuery {
  readonly actor: string;
  readonly materialId: string;
  readonly expectedContentVersion: number;
}

export interface ValidatedMaterialDto {
  readonly materialId: string;
  readonly contentVersion: number;
  readonly projectionDigest: string;
  readonly extraction: MaterialBodyExtraction;
}

export type ValidateMaterialError =
  | InvalidContentError
  | ForbiddenError
  | MaterialNotFoundError
  | StaleContentVersionError
  | InvalidReferenceError
  | SeriesOrdinalConflictError
  | SystemError;
export type ValidateMaterialResult = Result<
  ValidatedMaterialDto,
  ValidateMaterialError
>;
export type ValidateMaterialOperation = (
  query: ValidateMaterialQuery,
) => Promise<ValidateMaterialResult>;
