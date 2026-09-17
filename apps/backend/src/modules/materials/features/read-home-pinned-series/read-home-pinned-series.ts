import type { MaterialsPrisma } from "../../../../infrastructure/prisma/index.js";
import { readStoredGuidePage, type GuidePage } from "../../domain/guide-page.js";
import type { SystemError } from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";

/** Закреплённый на Главной продукт и то, чем его оформить (ADR 0026). */
export interface HomePinnedSeries {
  readonly id: string;
  readonly presentation: string;
  readonly card: GuidePage["card"];
}

export type ReadHomePinnedSeriesOperation = () => Promise<Result<HomePinnedSeries | null, SystemError>>;

export async function readHomePinnedSeries(prisma: MaterialsPrisma): ReturnType<ReadHomePinnedSeriesOperation> {
  try {
    const pin = await prisma.homeSeriesPin.findUniqueOrThrow({ where: { id: 1 }, select: { seriesId: true } });
    if (pin.seriesId === null) return { ok: true, value: null };
    const guide = await prisma.guide.findUnique({ where: { id: pin.seriesId }, select: { page: true, presentation: true } });
    if (guide === null) return { ok: true, value: null };
    const page = readStoredGuidePage(guide.page);
    return { ok: true, value: { id: pin.seriesId, presentation: guide.presentation, card: page === null || page === "invalid" ? null : page.card } };
  } catch (error) {
    return { ok: false, error: mapPostgresReadError(error) };
  }
}
