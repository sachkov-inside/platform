import type {
  MaterialAuthoring,
  Result,
} from "../material-authoring.interface.js";

type OperationError<Operation> = Operation extends (
  ...arguments_: never[]
) => Promise<Result<unknown, infer Error>>
  ? Error
  : never;

type AuthoringOperationError = OperationError<
  MaterialAuthoring[keyof MaterialAuthoring]
>;

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
