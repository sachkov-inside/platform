import {
  Prisma,
  type WebTelemetryPrisma,
} from "../../../../infrastructure/prisma/index.js";
import type { TelemetryReport } from "./report.js";

/** Database-owned routines keep quota, sample and coverage writes atomic. */
export async function storeReport(
  prisma: WebTelemetryPrisma,
  report: TelemetryReport,
  now: Date,
  route: string,
  device: "mobile" | "desktop",
) {
  if (report.kind === "vitals")
    for (const metric of report.metrics) {
      await prisma.$executeRaw(
        Prisma.sql`SELECT web_telemetry.record_vital(${now},${route},${device},${metric.name},${metric.value}::float8)`,
      );
    }
  if (report.kind === "error") {
    await prisma.$executeRaw(
      Prisma.sql`SELECT web_telemetry.record_error(${now},${route},${device},${report.source},${report.digest ?? ""},${report.name},${report.message})`,
    );
  }
}
