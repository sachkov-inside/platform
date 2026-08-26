import type { MaterialBodyChange } from "../../domain/material-body/material-body.js";
import type { MaterialMetadataValidationError } from "../../domain/material-revision-metadata.js";
import type {
  ForbiddenError,
  IdempotencyError,
  InvalidReferenceError,
  MaterialNotFoundError,
  MaterialRevisionDto,
  MaterialRevisionMetadataChanges,
  PersistenceConflictError,
  StaleRevisionError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export interface ReviseDraftCommand {
  readonly actor: string;
  readonly idempotencyKey: string;
  readonly materialId: string;
  readonly baseRevisionId: string;
  readonly changes: {
    readonly metadata?: MaterialRevisionMetadataChanges;
    readonly body?: readonly MaterialBodyChange[];
  };
}

export type ReviseDraftError =
  | MaterialMetadataValidationError
  | ForbiddenError
  | MaterialNotFoundError
  | StaleRevisionError
  | InvalidReferenceError
  | PersistenceConflictError
  | IdempotencyError
  | SystemError;
export type ReviseDraftResult = Result<MaterialRevisionDto, ReviseDraftError>;
export type ReviseDraftOperation = (
  command: ReviseDraftCommand,
) => Promise<ReviseDraftResult>;
