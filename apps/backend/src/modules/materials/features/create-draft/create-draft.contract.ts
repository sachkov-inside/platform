import type { MaterialMetadataValidationError } from "../../domain/material-metadata.js";
import type {
  ForbiddenError,
  IdempotencyError,
  InvalidReferenceError,
  MaterialMetadataSelectionInput,
  MaterialMutationReceiptDto,
  PersistenceConflictError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export interface CreateDraftCommand {
  readonly actor: string;
  readonly idempotencyKey: string;
  readonly metadata: MaterialMetadataSelectionInput;
  readonly body: unknown;
}

export type CreateDraftError =
  | MaterialMetadataValidationError
  | ForbiddenError
  | InvalidReferenceError
  | PersistenceConflictError
  | IdempotencyError
  | SystemError;
export type CreateDraftResult = Result<
  MaterialMutationReceiptDto,
  CreateDraftError
>;
export type CreateDraftOperation = (
  command: CreateDraftCommand,
) => Promise<CreateDraftResult>;
