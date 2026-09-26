import { z } from "zod";

import { describeError, writeLog } from "./log.js";

/** Где упала зависимость: Module и его операция. */
export interface DependencyScope {
  readonly module: string;
  readonly operation: string;
}

const outcomeSchema = z.object({
  code: z.string(),
  correlationId: z.string().optional(),
});
const failedResultSchema = z.object({ error: outcomeSchema });

type DependencyOutcome = z.infer<typeof outcomeSchema>;

/**
 * Записывает сбой зависимости: Module, операцию, причину и единицу работы. Причину не
 * заменяет ответ вызывающему: для участника сбой остаётся вариантом union операции.
 */
export function reportDependencyFailure(
  scope: DependencyScope,
  error: unknown,
): void {
  writeFailure(scope, error, undefined);
}

function writeFailure(
  scope: DependencyScope,
  error: unknown,
  outcome: DependencyOutcome | undefined,
): void {
  writeLog("error", "dependency_failure", {
    module: scope.module,
    operation: scope.operation,
    ...(outcome === undefined ? {} : { outcome: outcome.code }),
    ...(outcome?.correlationId === undefined
      ? {}
      : { correlationId: outcome.correlationId }),
    error: describeError(error),
  });
}

/**
 * Записывает сбой зависимости и возвращает вариант union, которым операция отвечает на него.
 * Код и `correlationId` этого варианта попадают в запись: по ним ответ находится в журнале.
 */
export function dependencyFailure<Variant>(
  scope: DependencyScope,
  error: unknown,
  variant: Variant,
): Variant {
  const outcome =
    failedResultSchema.safeParse(variant).data?.error ??
    outcomeSchema.safeParse(variant).data;
  writeFailure(scope, error, outcome);
  return variant;
}
