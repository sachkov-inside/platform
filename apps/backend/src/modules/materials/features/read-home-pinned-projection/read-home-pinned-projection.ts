import type { MaterialsPrisma } from "../../../../infrastructure/prisma/index.js";
import type { PublishedMaterialProjectionDto } from "../../facets/published-material-reader/published-material.contract.js";
import type { SystemError } from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";
import { selectHomePinnedMaterialProjection } from "../../infrastructure/postgres/published-material-reader/published-material-projection.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";

export type ReadHomePinnedProjectionOperation = () => Promise<Result<PublishedMaterialProjectionDto | null, SystemError>>;

export async function readHomePinnedProjection(prisma: MaterialsPrisma): ReturnType<ReadHomePinnedProjectionOperation> {
  try {
    return { ok: true, value: await selectHomePinnedMaterialProjection(prisma) };
  } catch (error) {
    return { ok: false, error: mapPostgresReadError(error) };
  }
}
