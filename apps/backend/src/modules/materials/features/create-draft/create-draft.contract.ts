import type { MaterialMetadataValidationError } from "../../domain/material-revision-metadata.js";
import type {
  ForbiddenError,
  IdempotencyError,
  InvalidReferenceError,
  MaterialRevisionDto,
  MaterialRevisionMetadataInput,
  PersistenceConflictError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export interface CreateDraftCommand {
  readonly actor: string;
  readonly idempotencyKey: string;
  readonly metadata: MaterialRevisionMetadataInput;
  readonly body: unknown;
}

export type CreateDraftError =
  | MaterialMetadataValidationError
  | ForbiddenError
  | InvalidReferenceError
  | PersistenceConflictError
  | IdempotencyError
  | SystemError;
export type CreateDraftResult = Result<MaterialRevisionDto, CreateDraftError>;
export type CreateDraftOperation = (
  command: CreateDraftCommand,
) => Promise<CreateDraftResult>;
