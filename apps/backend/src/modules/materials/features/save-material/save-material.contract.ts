import type { PublicationState } from "../../domain/material.js";
import type { MaterialMetadataValidationError } from "../../domain/material-metadata.js";
import type {
  ForbiddenError,
  IdempotencyError,
  InvalidPublicationTransitionError,
  InvalidReferenceError,
  MaterialMetadataSelectionInput,
  MaterialMutationReceiptDto,
  MaterialNotFoundError,
  PersistenceConflictError,
  SlugLockedError,
  StaleContentVersionError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export interface SaveMaterialCommand {
  readonly actor: string;
  readonly idempotencyKey: string;
  readonly materialId: string;
  readonly expectedContentVersion: number;
  readonly publicationState: PublicationState;
  readonly metadata: MaterialMetadataSelectionInput;
  readonly body: unknown;
}

export type SaveMaterialError =
  | MaterialMetadataValidationError
  | ForbiddenError
  | MaterialNotFoundError
  | StaleContentVersionError
  | SlugLockedError
  | InvalidPublicationTransitionError
  | InvalidReferenceError
  | PersistenceConflictError
  | IdempotencyError
  | SystemError;
export type SaveMaterialResult = Result<
  MaterialMutationReceiptDto,
  SaveMaterialError
>;
export type SaveMaterialOperation = (
  command: SaveMaterialCommand,
) => Promise<SaveMaterialResult>;
