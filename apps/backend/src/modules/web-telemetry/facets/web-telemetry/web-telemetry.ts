import { z } from "zod";
import { type WebTelemetryPrisma } from "../../../../infrastructure/prisma/index.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { Accounts } from "../../../accounts/index.js";
import { telemetryReportSchema } from "../../features/record-report/report.js";
import { storeReport } from "../../features/record-report/store-report.js";
import { cleanTelemetry } from "../../features/clean-telemetry/clean-telemetry.js";
import { readSummary } from "../../features/read-summary/read-summary.js";
import { normalizeTelemetryRoute } from "../../domain/route-templates.js";

export class WebTelemetry {
  private readonly clock: () => Date;
  constructor(
    private readonly dependencies: {
      readonly prisma: WebTelemetryPrisma;
      readonly accounts: Pick<Accounts, "checkPermission">;
      readonly clock?: () => Date;
    },
  ) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  async record(input: unknown) {
    const parsed = telemetryReportSchema.safeParse(input);
    if (!parsed.success)
      return { ok: false as const, error: { code: "invalid_input" as const } };
    const report = parsed.data;
    const now = this.clock();
    const route = normalizeTelemetryRoute(report.route);
    const device = report.mobile ? "mobile" : "desktop";
    try {
      await storeReport(this.dependencies.prisma, report, now, route, device);
      return { ok: true as const };
    } catch (error) {
      return dependencyFailure(
        { module: "web-telemetry", operation: "record" },
        error,
        {
          ok: false as const,
          error: { code: "dependency_unavailable" as const },
        },
      );
    }
  }

  async summary(accountId: string, days: number) {
    if (!z.number().int().min(1).max(30).safeParse(days).success)
      return { ok: false as const, error: { code: "invalid_input" as const } };
    const permission = await this.dependencies.accounts.checkPermission({
      accountId,
      permission: "platform:admin",
    });
    if (!permission.ok && permission.error.code === "internal_error")
      return {
        ok: false as const,
        error: { code: "dependency_unavailable" as const },
      };
    if (!permission.ok || !permission.allowed)
      return { ok: false as const, error: { code: "forbidden" as const } };
    const now = this.clock();
    const from = new Date(now);
    from.setUTCHours(0, 0, 0, 0);
    from.setUTCDate(from.getUTCDate() - days + 1);
    try {
      return {
        ok: true as const,
        value: await readSummary(this.dependencies.prisma, from, now),
      };
    } catch (error) {
      return dependencyFailure(
        { module: "web-telemetry", operation: "summary" },
        error,
        {
          ok: false as const,
          error: { code: "dependency_unavailable" as const },
        },
      );
    }
  }
  async clean(now = this.clock()) {
    try {
      return {
        ok: true as const,
        removed: await cleanTelemetry(this.dependencies.prisma, now),
      };
    } catch (error) {
      return dependencyFailure(
        { module: "web-telemetry", operation: "clean" },
        error,
        {
          ok: false as const,
          error: { code: "dependency_unavailable" as const },
        },
      );
    }
  }
}
