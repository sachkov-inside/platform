import type {
  ForbiddenError,
  IdempotencyError,
  InvalidContentError,
  InvalidReferenceError,
  MaterialNotFoundError,
  PersistenceConflictError,
  PublicationLifecycleEventDto,
  RevisionNotFoundError,
  StalePublicationError,
  StaleRevisionError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export interface PublishRevisionCommand {
  readonly actor: string;
  readonly idempotencyKey: string;
  readonly materialId: string;
  readonly revisionId: string;
  readonly expectedPublishedRevisionId: string | null;
}

export type PublishRevisionError =
  | InvalidContentError
  | ForbiddenError
  | MaterialNotFoundError
  | RevisionNotFoundError
  | StaleRevisionError
  | StalePublicationError
  | InvalidReferenceError
  | PersistenceConflictError
  | IdempotencyError
  | SystemError;
export type PublishRevisionResult = Result<
  PublicationLifecycleEventDto,
  PublishRevisionError
>;
export type PublishRevisionOperation = (
  command: PublishRevisionCommand,
) => Promise<PublishRevisionResult>;
