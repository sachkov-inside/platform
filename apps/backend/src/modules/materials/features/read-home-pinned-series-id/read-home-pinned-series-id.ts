import type { MaterialsPrisma } from "../../../../infrastructure/prisma/index.js";
import type { SystemError } from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";

export type ReadHomePinnedSeriesIdOperation = () => Promise<Result<string | null, SystemError>>;

export async function readHomePinnedSeriesId(prisma: MaterialsPrisma): ReturnType<ReadHomePinnedSeriesIdOperation> {
  try {
    const pin = await prisma.homeSeriesPin.findUniqueOrThrow({ where: { id: 1 }, select: { seriesId: true } });
    return { ok: true, value: pin.seriesId };
  } catch (error) {
    return { ok: false, error: mapPostgresReadError(error) };
  }
}
