import { ACTIVITY_RETENTION_MILLISECONDS } from "./confirmed-activity.js";
import { z } from "zod";
export const ACTIVITY_RETENTION_SECONDS =
  ACTIVITY_RETENTION_MILLISECONDS / 1000;
export const ACTIVITY_RETENTION_BATCH_SIZE = 1000;
export const activityRetentionTransactionOptions = {
  timeout: 5000,
  maxWait: 1000,
  isolationLevel: "ReadCommitted",
} as const;
export const activityRetentionStatusRows = z
  .array(
    z.object({
      asOf: z.iso.datetime(),
      cutoff: z.iso.datetime(),
      oldestExpiredAt: z.iso.datetime().nullable(),
      lagSeconds: z.number().nonnegative().nullable(),
    }),
  )
  .length(1);
export function activityRetentionStatus(raw: unknown) {
  const row = activityRetentionStatusRows.parse(raw)[0];
  if (
    row === undefined ||
    (row.oldestExpiredAt === null) !== (row.lagSeconds === null)
  )
    throw new Error("Activity retention status unavailable");
  return {
    status: "known" as const,
    ...row,
    hasMore: row.oldestExpiredAt !== null,
  };
}
