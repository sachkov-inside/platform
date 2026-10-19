import {
  DIAGNOSTIC_SOURCE_ROW_LIMIT,
  diagnosticAccountScopeSchema,
  type DiagnosticAccountScope,
  diagnosticSnapshotOptions,
  diagnosticSourceBudgetFailure,
  setDiagnosticStatementBudget,
  type DiagnosticSourceBudgetFailure,
} from "../../../../infrastructure/diagnostic-read-budget.js";
import type { ReadingActivityPrisma } from "../../../../infrastructure/prisma/index.js";
import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  Prisma,
  type ReadingActivityPrismaClient,
} from "../../../../infrastructure/prisma/index.js";

const MAX_MATERIALS = 1_000;
const materialIdsSchema = z.array(z.uuid().toLowerCase()).max(MAX_MATERIALS);
const rowsSchema = z.array(
  z.object({ account_id: z.uuid(), first_opened_at: z.date() }),
);

export type FirstOpensResult =
  | {
      readonly ok: true;
      /** Account ID to the first time it opened any of the Materials. */
      readonly value: ReadonlyMap<string, Date>;
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "invalid_request" | "dependency_unavailable";
      };
    };

/**
 * When each Account first opened any of the given Materials. An open is recorded only for a
 * signed-in reader after a visible, permitted render.
 */
export class MaterialFirstOpens {
  constructor(private readonly prisma: ReadingActivityPrismaClient) {}

  list(materialIds: readonly string[]): Promise<FirstOpensResult> {
    return readMaterialFirstOpens(this.prisma, materialIds);
  }

  async listForDiagnostics(
    materialIds: readonly string[],
    scope?: DiagnosticAccountScope,
  ): Promise<FirstOpensResult | DiagnosticSourceBudgetFailure> {
    if (!materialIdsSchema.safeParse(materialIds).success)
      return { ok: false, error: { code: "invalid_request" } };
    if (materialIds.length === 0) return { ok: true, value: new Map() };
    const parsedScope =
      scope === undefined
        ? undefined
        : diagnosticAccountScopeSchema.safeParse(scope);
    if (parsedScope !== undefined && !parsedScope.success)
      return { ok: false, error: { code: "invalid_request" } };
    const normalizedScope = parsedScope?.data;
    const boundedScope =
      normalizedScope !== undefined && "accountIds" in normalizedScope
        ? { accountIds: [...new Set(normalizedScope.accountIds)] }
        : normalizedScope;
    if (
      boundedScope !== undefined &&
      "accountIds" in boundedScope &&
      boundedScope.accountIds.length > DIAGNOSTIC_SOURCE_ROW_LIMIT
    )
      return diagnosticSourceBudgetFailure;
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await setDiagnosticStatementBudget(transaction);
        return readMaterialFirstOpens(
          transaction,
          materialIds,
          "listForDiagnostics",
          boundedScope,
        );
      }, diagnosticSnapshotOptions);
    } catch (error) {
      return dependencyFailure(
        { module: "reading-activity", operation: "listForDiagnostics" },
        error,
        {
          ok: false as const,
          error: { code: "dependency_unavailable" as const },
        },
      );
    }
  }
}

function readMaterialFirstOpens(
  prisma: ReadingActivityPrisma,
  materialIds: readonly string[],
): Promise<FirstOpensResult>;
function readMaterialFirstOpens(
  prisma: ReadingActivityPrisma,
  materialIds: readonly string[],
  operation: "listForDiagnostics",
  scope?: DiagnosticAccountScope,
): Promise<FirstOpensResult | DiagnosticSourceBudgetFailure>;
async function readMaterialFirstOpens(
  prisma: ReadingActivityPrisma,
  materialIds: readonly string[],
  operation = "listFirstOpens",
  scope?: DiagnosticAccountScope,
): Promise<FirstOpensResult | DiagnosticSourceBudgetFailure> {
  const parsed = materialIdsSchema.safeParse(materialIds);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  if (parsed.data.length === 0) return { ok: true, value: new Map() };
  const accounts =
    scope !== undefined && "accountIds" in scope
      ? Prisma.sql`and visit.account_id = any(${[...scope.accountIds]}::uuid[])`
      : Prisma.empty;
  const window =
    scope !== undefined && "from" in scope
      ? Prisma.sql`having min(visit.first_opened_at) >= ${scope.from} and min(visit.first_opened_at) < ${scope.to}`
      : Prisma.empty;
  const limit =
    operation === "listForDiagnostics"
      ? Prisma.sql`limit ${DIAGNOSTIC_SOURCE_ROW_LIMIT + 1}`
      : Prisma.empty;
  try {
    const rows = rowsSchema.parse(
      await prisma.$queryRaw(Prisma.sql`
        select visit.account_id, min(visit.first_opened_at) as first_opened_at
        from reading_activity.material_visits as visit
        where visit.material_id = any(${parsed.data}::uuid[])
        ${accounts}
        group by visit.account_id ${window} ${limit}
      `),
    );
    if (
      operation === "listForDiagnostics" &&
      rows.length > DIAGNOSTIC_SOURCE_ROW_LIMIT
    )
      return diagnosticSourceBudgetFailure;
    return {
      ok: true,
      value: new Map(rows.map((row) => [row.account_id, row.first_opened_at])),
    };
  } catch (error) {
    return dependencyFailure({ module: "reading-activity", operation }, error, {
      ok: false,
      error: { code: "dependency_unavailable" },
    } as const);
  }
}
