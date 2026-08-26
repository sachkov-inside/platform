import type { Result } from "../result.js";
import type {
  MaterialsPrismaClient,
  MaterialsPrismaTransaction,
} from "../../../infrastructure/prisma/index.js";

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
  prisma: MaterialsPrismaClient,
  operation: (
    transaction: MaterialsPrismaTransaction,
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
    const value = await prisma.$transaction((transaction) =>
      operation(transaction, rollback),
    );
    return { ok: true, value };
  } catch (error) {
    return failure(
      error instanceof TransactionRollback
        ? error.applicationError
        : mapUnexpected(error),
    );
  }
}
