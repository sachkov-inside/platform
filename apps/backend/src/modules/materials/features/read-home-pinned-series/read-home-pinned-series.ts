import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { MaterialsPrisma } from "../../../../infrastructure/prisma/index.js";
import {
  productPageHero,
  type ProductPageCard,
  type ProductPageHero,
} from "../../domain/product-page.js";
import { readProductPage } from "../../shared/product-page-reader.js";
import type { SystemError } from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";

/** Закреплённый на Главной продукт и то, чем его оформить (ADR 0026). */
export interface HomePinnedSeries {
  readonly id: string;
  readonly presentation: string;
  readonly card: ProductPageCard | null;
  /** Первый экран страницы продукта: карточка Главной повторяет его. */
  readonly hero: ProductPageHero | null;
}

export type ReadHomePinnedSeriesOperation = () => Promise<
  Result<HomePinnedSeries | null, SystemError>
>;

export async function readHomePinnedSeries(
  prisma: MaterialsPrisma,
): ReturnType<ReadHomePinnedSeriesOperation> {
  try {
    return { ok: true, value: await loadHomePinnedSeries(prisma) };
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

/** Shared persistence read; each public operation records its own dependency failure. */
export async function loadHomePinnedSeries(
  prisma: MaterialsPrisma,
): Promise<HomePinnedSeries | null> {
  const pin = await prisma.homeSeriesPin.findUniqueOrThrow({
    where: { id: 1 },
    select: { seriesId: true },
  });
  if (pin.seriesId === null) return null;
  const product = await prisma.product.findUnique({
    where: { id: pin.seriesId },
    select: { page: true, presentation: true, slug: true },
  });
  if (product === null) return null;
  const page = readProductPage(
    product.page,
    `Home pinned Product ${product.slug}`,
  );
  return {
    id: pin.seriesId,
    presentation: product.presentation,
    card: page?.card ?? null,
    hero: productPageHero(page),
  };
}
