import { z } from "zod";
import {
  Prisma,
  type PlatformPrisma,
} from "../../../src/infrastructure/prisma/index.js";

const DAY_MILLISECONDS = 86_400_000;
const clockRows = z.array(z.object({ at: z.date() })).length(1);

/** Anchor fixtures and their bounded window to the same authoritative clock as activity admission. */
export async function activityTestClock(
  prisma: Pick<PlatformPrisma, "$queryRaw">,
) {
  const row = clockRows.parse(
    await prisma.$queryRaw(Prisma.sql`select transaction_timestamp() as at`),
  )[0];
  if (row === undefined) throw new Error("Fixture DB clock unavailable");
  return {
    at: row.at,
    window: {
      from: new Date(row.at.getTime() - DAY_MILLISECONDS).toISOString(),
      to: new Date(row.at.getTime() + DAY_MILLISECONDS).toISOString(),
    },
  };
}
