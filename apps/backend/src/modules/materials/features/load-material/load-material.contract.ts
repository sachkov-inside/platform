import type {
  ForbiddenError,
  InvalidContentError,
  MaterialDto,
  MaterialNotFoundError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export interface LoadMaterialQuery {
  readonly actor: string;
  readonly materialId: string;
}

export type LoadMaterialError =
  | InvalidContentError
  | ForbiddenError
  | MaterialNotFoundError
  | SystemError;
export type LoadMaterialResult = Result<MaterialDto, LoadMaterialError>;
export type LoadMaterialOperation = (
  query: LoadMaterialQuery,
) => Promise<LoadMaterialResult>;
