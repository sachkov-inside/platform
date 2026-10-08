import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { MaterialsPrisma } from "../../../../infrastructure/prisma/index.js";
import { selectHomeMaterialProjections } from "../../infrastructure/postgres/published-material-reader/published-material-projection.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import { loadHomePinnedSeries } from "../read-home-pinned-series/read-home-pinned-series.js";
import type { ReadHomeProjectionsOperation } from "./read-home-projections.contract.js";

export async function readHomeProjections(
  prisma: MaterialsPrisma,
): ReturnType<ReadHomeProjectionsOperation> {
  try {
    const pin = await loadHomePinnedSeries(prisma);
    return {
      ok: true,
      value: await selectHomeMaterialProjections(prisma, pin),
    };
  } catch (error) {
    return {
      ok: false,
      error: dependencyFailure(
        { module: "materials", operation: "readHomeProjections" },
        error,
        mapPostgresReadError(error),
      ),
    };
  }
}
