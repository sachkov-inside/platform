import {
  Prisma,
  type WebTelemetryPrisma,
} from "../../../../infrastructure/prisma/index.js";

const retentionDays = 30;
const millisecondsPerDay = 86_400_000;
const cleanupBatchSize = 5_000;

export async function cleanTelemetry(
  prisma: WebTelemetryPrisma,
  now: Date,
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * millisecondsPerDay);
  const batches = [
    Prisma.sql`DELETE FROM web_telemetry.vital_samples WHERE ctid IN (SELECT ctid FROM web_telemetry.vital_samples WHERE occurred_at<${cutoff} ORDER BY occurred_at LIMIT ${cleanupBatchSize})`,
    Prisma.sql`DELETE FROM web_telemetry.errors WHERE ctid IN (SELECT ctid FROM web_telemetry.errors WHERE occurred_at<${cutoff} ORDER BY occurred_at LIMIT ${cleanupBatchSize})`,
    Prisma.sql`DELETE FROM web_telemetry.coverage WHERE ctid IN (SELECT ctid FROM web_telemetry.coverage WHERE day<(${cutoff} AT TIME ZONE 'UTC')::date ORDER BY day LIMIT ${cleanupBatchSize})`,
    Prisma.sql`DELETE FROM web_telemetry.daily_quota WHERE ctid IN (SELECT ctid FROM web_telemetry.daily_quota WHERE day<(${cutoff} AT TIME ZONE 'UTC')::date ORDER BY day LIMIT ${cleanupBatchSize})`,
  ];
  let removed = 0;
  for (const batch of batches) {
    let count: number;
    do {
      count = await prisma.$executeRaw(batch);
      removed += count;
    } while (count === cleanupBatchSize);
  }
  return removed;
}
