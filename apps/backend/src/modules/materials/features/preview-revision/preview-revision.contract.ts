import type { RenderedMaterialBody } from "../../domain/material-body/material-body.js";
import type {
  ForbiddenError,
  InvalidContentError,
  MaterialNotFoundError,
  MaterialRevisionMetadataDto,
  RevisionNotFoundError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export interface PreviewRevisionQuery {
  readonly actor: string;
  readonly materialId: string;
  readonly revisionId: string;
}

export interface PreviewRevisionDto {
  readonly materialId: string;
  readonly revisionId: string;
  readonly metadata: MaterialRevisionMetadataDto;
  readonly cacheScope: "private-no-store";
  readonly body: RenderedMaterialBody;
}

export type PreviewRevisionError =
  | InvalidContentError
  | ForbiddenError
  | MaterialNotFoundError
  | RevisionNotFoundError
  | SystemError;
export type PreviewRevisionResult = Result<
  PreviewRevisionDto,
  PreviewRevisionError
>;
export type PreviewRevisionOperation = (
  query: PreviewRevisionQuery,
) => Promise<PreviewRevisionResult>;
