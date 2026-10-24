import { z } from "zod";
import { Prisma } from "./prisma/index.js";

/** Internal relevant candidate/result budget; callers cannot raise it through diagnostic input. */
export const DIAGNOSTIC_SOURCE_ROW_LIMIT = 2_000;
const DIAGNOSTIC_STATEMENT_TIMEOUT_MS = 2_000;
export const diagnosticSnapshotOptions = {
  isolationLevel: "RepeatableRead",
  timeout: 5_000,
  maxWait: 1_000,
} as const;
export type DiagnosticSourceBudgetFailure = {
  readonly ok: false;
  readonly error: { readonly code: "source_budget_exceeded" };
};
export const diagnosticSourceBudgetFailure: DiagnosticSourceBudgetFailure = {
  ok: false,
  error: { code: "source_budget_exceeded" },
};

/** Only the owning read transaction is passed here; the setting expires at its end. */
export async function setDiagnosticStatementBudget(transaction: {
  $queryRaw(query: Prisma.Sql): Promise<unknown>;
}): Promise<void> {
  await transaction.$queryRaw(
    Prisma.sql`select set_config('statement_timeout', ${String(DIAGNOSTIC_STATEMENT_TIMEOUT_MS)}, true)`,
  );
}

export type DiagnosticAccountScope =
  | { readonly from: Date; readonly to: Date }
  | { readonly accountIds: readonly string[] };

export const diagnosticAccountScopeSchema = z.union([
  z
    .strictObject({ from: z.date(), to: z.date() })
    .refine(({ from, to }) => from < to),
  z.strictObject({ accountIds: z.array(z.uuid().toLowerCase()) }),
]);
