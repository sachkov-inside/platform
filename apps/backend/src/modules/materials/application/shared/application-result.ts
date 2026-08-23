import type {
  MaterialAuthoringError,
  Result,
} from "../material-authoring.interface.js";

export class AuthoringRollback extends Error {
  constructor(readonly applicationError: MaterialAuthoringError) {
    super(applicationError.code);
  }
}

export function rollback<Error extends MaterialAuthoringError>(error: Error): never {
  throw new AuthoringRollback(error);
}

export function failure<Value, Error extends MaterialAuthoringError>(
  error: Error,
): Result<Value, Error> {
  return { ok: false, error };
}

export function failureFromTransaction<Error extends MaterialAuthoringError>(
  error: unknown,
  mapUnexpected: (error: unknown) => Error,
): Result<never, Error> {
  const applicationError =
    error instanceof AuthoringRollback
      ? error.applicationError
      : mapUnexpected(error);
  return failure(applicationError as Error);
}
