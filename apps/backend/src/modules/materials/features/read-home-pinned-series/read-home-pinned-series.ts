import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { MaterialsPrisma } from "../../../../infrastructure/prisma/index.js";
import type { GuidePageCard } from "../../domain/guide-page.js";
import { readGuidePage } from "../../shared/guide-page-reader.js";
import type { SystemError } from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";

/** Закреплённый на Главной продукт и то, чем его оформить (ADR 0026). */
export interface HomePinnedSeries {
  readonly id: string;
  readonly presentation: string;
  readonly card: GuidePageCard | null;
}

export type ReadHomePinnedSeriesOperation = () => Promise<
  Result<HomePinnedSeries | null, SystemError>
>;

export async function readHomePinnedSeries(
  prisma: MaterialsPrisma,
): ReturnType<ReadHomePinnedSeriesOperation> {
  try {
    const pin = await prisma.homeSeriesPin.findUniqueOrThrow({
      where: { id: 1 },
      select: { seriesId: true },
    });
    if (pin.seriesId === null) return { ok: true, value: null };
    const guide = await prisma.guide.findUnique({
      where: { id: pin.seriesId },
      select: { page: true, presentation: true, slug: true },
    });
    if (guide === null) return { ok: true, value: null };
    const page = readGuidePage(guide.page, `Home pinned Guide ${guide.slug}`);
    return {
      ok: true,
      value: {
        id: pin.seriesId,
        presentation: guide.presentation,
        card: page?.card ?? null,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: dependencyFailure(
        { module: "materials", operation: "readHomePinnedSeries" },
        error,
        mapPostgresReadError(error),
      ),
    };
  }
}
