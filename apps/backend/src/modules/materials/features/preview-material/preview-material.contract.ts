import type { PublicationState } from "../../domain/material.js";
import type { RenderedMaterialBody } from "../../domain/material-body/material-body.js";
import type {
  ForbiddenError,
  InvalidContentError,
  MaterialMetadataDto,
  MaterialNotFoundError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export interface PreviewMaterialQuery {
  readonly actor: string;
  readonly materialId: string;
}

export interface PreviewMaterialDto {
  readonly materialId: string;
  readonly contentVersion: number;
  readonly publicationState: PublicationState;
  readonly metadata: MaterialMetadataDto;
  readonly cacheScope: "private-no-store";
  readonly body: RenderedMaterialBody;
}

export type PreviewMaterialError =
  | InvalidContentError
  | ForbiddenError
  | MaterialNotFoundError
  | SystemError;
export type PreviewMaterialResult = Result<
  PreviewMaterialDto,
  PreviewMaterialError
>;
export type PreviewMaterialOperation = (
  query: PreviewMaterialQuery,
) => Promise<PreviewMaterialResult>;
