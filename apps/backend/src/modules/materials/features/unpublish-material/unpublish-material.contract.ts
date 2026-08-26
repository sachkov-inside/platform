import type {
  ForbiddenError,
  IdempotencyError,
  InvalidContentError,
  MaterialNotFoundError,
  PublicationLifecycleEventDto,
  StalePublicationError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export interface UnpublishMaterialCommand {
  readonly actor: string;
  readonly idempotencyKey: string;
  readonly materialId: string;
  readonly expectedPublishedRevisionId: string;
}

export type UnpublishMaterialError =
  | InvalidContentError
  | ForbiddenError
  | MaterialNotFoundError
  | StalePublicationError
  | { readonly code: "publication_not_found" }
  | IdempotencyError
  | SystemError;
export type UnpublishMaterialResult = Result<
  PublicationLifecycleEventDto,
  UnpublishMaterialError
>;
export type UnpublishMaterialOperation = (
  command: UnpublishMaterialCommand,
) => Promise<UnpublishMaterialResult>;
