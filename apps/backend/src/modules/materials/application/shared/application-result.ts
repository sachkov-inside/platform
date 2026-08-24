import type { Result } from "../../result.js";
import type {
  AuthoringDatabase,
  AuthoringTransaction,
} from "../../infrastructure/postgres/database.js";

export interface ApplicationError {
  readonly code: string;
}

export type Rollback<Error extends ApplicationError> = (error: Error) => never;

export function failure<Value, Error extends ApplicationError>(
  error: Error,
): Result<Value, Error> {
  return { ok: false, error };
}

export async function executeAuthoringTransaction<
  Value,
  OperationError extends ApplicationError,
>(
  database: AuthoringDatabase,
  operation: (
    transaction: AuthoringTransaction,
    rollback: Rollback<OperationError>,
  ) => Promise<Value>,
  mapUnexpected: (error: unknown) => OperationError,
): Promise<Result<Value, OperationError>> {
  class TransactionRollback extends Error {
    constructor(readonly applicationError: OperationError) {
      super(applicationError.code);
    }
  }

  const rollback: Rollback<OperationError> = (error) => {
    throw new TransactionRollback(error);
  };

  try {
    const value = await database
      .transaction()
      .execute((transaction) => operation(transaction, rollback));
    return { ok: true, value };
  } catch (error) {
    return failure(
      error instanceof TransactionRollback
        ? error.applicationError
        : mapUnexpected(error),
    );
  }
}
