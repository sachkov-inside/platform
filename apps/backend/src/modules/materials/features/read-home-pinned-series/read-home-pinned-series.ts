import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { ProductDiscovery } from "../../../products/index.js";
import {
  type ProductPageCard,
  type ProductPageHero,
} from "../../domain/product-page.js";
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
  products: Pick<ProductDiscovery, "homePin">,
): ReturnType<ReadHomePinnedSeriesOperation> {
  try {
    return { ok: true, value: await loadHomePinnedSeries(products) };
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

export function loadHomePinnedSeries(
  products: Pick<ProductDiscovery, "homePin">,
): Promise<HomePinnedSeries | null> {
  return products.homePin();
}
