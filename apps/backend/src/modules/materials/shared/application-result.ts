import { dependencyFailure } from "../../../infrastructure/observability/index.js";
import type { Result } from "../result.js";
import { isSystemErrorCode } from "./postgres-error-mapping.js";
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
  operationName: string,
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
    if (error instanceof TransactionRollback)
      return failure(error.applicationError);
    const mapped = mapUnexpected(error);
    // Конфликт и неверная ссылка — ответ автору; сбоем зависимости остаются только системные коды.
    return failure(
      isSystemErrorCode(mapped.code)
        ? dependencyFailure(
            { module: "materials", operation: operationName },
            error,
            mapped,
          )
        : mapped,
    );
  }
}
