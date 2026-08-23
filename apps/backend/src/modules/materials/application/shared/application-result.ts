import type {
  CreateDraftError,
  LoadDraftError,
  PreviewRevisionError,
  PublishRevisionError,
  RestoreRevisionError,
  ReviseDraftError,
  Result,
  UnpublishMaterialError,
  ValidateRevisionError,
} from "../material-authoring.interface.js";

type AuthoringOperationError =
  | CreateDraftError
  | LoadDraftError
  | PreviewRevisionError
  | PublishRevisionError
  | RestoreRevisionError
  | ReviseDraftError
  | UnpublishMaterialError
  | ValidateRevisionError;

export class AuthoringRollback extends Error {
  constructor(readonly applicationError: AuthoringOperationError) {
    super(applicationError.code);
  }
}

export function rollback<Error extends AuthoringOperationError>(error: Error): never {
  throw new AuthoringRollback(error);
}

export function failure<Value, Error extends AuthoringOperationError>(
  error: Error,
): Result<Value, Error> {
  return { ok: false, error };
}

export function failureFromTransaction<Error extends AuthoringOperationError>(
  error: unknown,
  mapUnexpected: (error: unknown) => Error,
): Result<never, Error> {
  const applicationError =
    error instanceof AuthoringRollback
      ? error.applicationError
      : mapUnexpected(error);
  return failure(applicationError as Error);
}
