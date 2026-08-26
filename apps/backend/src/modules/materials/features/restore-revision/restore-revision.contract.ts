import type {
  ForbiddenError,
  IdempotencyError,
  InvalidContentError,
  InvalidReferenceError,
  MaterialNotFoundError,
  MaterialRevisionDto,
  PersistenceConflictError,
  RevisionNotFoundError,
  StaleRevisionError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export interface RestoreRevisionCommand {
  readonly actor: string;
  readonly idempotencyKey: string;
  readonly materialId: string;
  readonly revisionId: string;
  readonly baseRevisionId: string;
}

export type RestoreRevisionError =
  | InvalidContentError
  | ForbiddenError
  | MaterialNotFoundError
  | RevisionNotFoundError
  | StaleRevisionError
  | InvalidReferenceError
  | PersistenceConflictError
  | IdempotencyError
  | SystemError;
export type RestoreRevisionResult = Result<
  MaterialRevisionDto,
  RestoreRevisionError
>;
export type RestoreRevisionOperation = (
  command: RestoreRevisionCommand,
) => Promise<RestoreRevisionResult>;
