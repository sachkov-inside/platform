import { projectFunnelDiagnosticPage } from "./funnel-diagnostics-view.js";
import { z } from "zod";
import {
  funnelSourceSchema,
  funnelReportQuerySchema,
} from "../read-funnel-report/read-funnel-report.contract.js";
import {
  compareFunnelSources,
  readFunnelReport,
  type ReadFunnelReportDependencies,
} from "../read-funnel-report/read-funnel-report.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";

export const funnelDiagnosticsQuerySchema = funnelReportQuerySchema
  .extend({
    limit: z.int().min(1).max(50).default(20),
    cursor: z.string().max(2048).optional(),
  })
  .refine((input) => {
    const duration = Date.parse(input.to) - Date.parse(input.from);
    return duration > 0 && duration <= 31 * 86_400_000;
  });

const cursorSchema = z.strictObject({
  v: z.literal(1),
  from: z.string(),
  to: z.string(),
  productId: z.uuid().nullable(),
  chapterId: z.uuid().nullable(),
  after: funnelSourceSchema,
});
function readCursor(cursor: string | undefined) {
  if (cursor === undefined) return null;
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(cursor));
    return parsed.success ? parsed.data : false;
  } catch {
    // Not a dependency failure: a caller supplied malformed cursor JSON.
    return false;
  }
}

export async function readFunnelDiagnostics(
  dependencies: ReadFunnelReportDependencies,
  actorId: string,
  input: unknown,
) {
  const parsed = funnelDiagnosticsQuerySchema.safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(actorId).success)
    return { ok: false as const, error: { code: "invalid_request" as const } };
  try {
    const permission = await dependencies.accounts.checkPermission({
      accountId: actorId,
      permission: "platform:admin",
    });
    if (!permission.ok && permission.error.code === "internal_error")
      return {
        ok: false as const,
        error: { code: "dependency_unavailable" as const },
      };
    if (!permission.ok || !permission.allowed)
      return { ok: false as const, error: { code: "forbidden" as const } };
    const query = parsed.data;
    const scope = {
      from: new Date(query.from).toISOString(),
      to: new Date(query.to).toISOString(),
      productId: query.productId ?? null,
      chapterId: query.chapterId ?? null,
    };
    const cursor = readCursor(query.cursor);
    if (
      cursor === false ||
      (cursor !== null &&
        (cursor.from !== scope.from ||
          cursor.to !== scope.to ||
          cursor.productId !== scope.productId ||
          cursor.chapterId !== scope.chapterId))
    )
      return {
        ok: false as const,
        error: { code: "invalid_request" as const },
      };
    const report = await readFunnelReport(
      dependencies,
      actorId,
      {
        from: scope.from,
        to: scope.to,
        ...(query.productId === undefined
          ? {}
          : { productId: query.productId }),
        ...(query.chapterId === undefined
          ? {}
          : { chapterId: query.chapterId }),
      },
      true,
    );
    if (!report.ok) return { ...report, coverage: "unknown" as const };
    const remaining =
      cursor === null
        ? report.value.rows
        : report.value.rows.filter(
            (row) => compareFunnelSources(row.source, cursor.after) > 0,
          );
    const rows = remaining.slice(0, query.limit);
    const last = rows.at(-1);
    const nextCursor =
      remaining.length > rows.length && last !== undefined
        ? JSON.stringify({ v: 1, ...scope, after: last.source })
        : null;
    return {
      ok: true as const,
      value: projectFunnelDiagnosticPage(report.value, { rows, nextCursor }),
    };
  } catch (error) {
    return dependencyFailure(
      { module: "sales-funnel", operation: "readFunnelDiagnostics" },
      error,
      {
        ok: false as const,
        error: { code: "dependency_unavailable" as const },
      },
    );
  }
}
