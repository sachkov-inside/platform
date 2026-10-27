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
export interface HomePinnedProduct {
  readonly id: string;
  readonly presentation: string;
  readonly card: ProductPageCard | null;
  /** Первый экран страницы продукта: карточка Главной повторяет его. */
  readonly hero: ProductPageHero | null;
}

export type ReadHomePinnedProductOperation = () => Promise<
  Result<HomePinnedProduct | null, SystemError>
>;

export async function readHomePinnedProduct(
  products: Pick<ProductDiscovery, "homePin">,
): ReturnType<ReadHomePinnedProductOperation> {
  try {
    return { ok: true, value: await loadHomePinnedProduct(products) };
  } catch (error) {
    return {
      ok: false,
      error: dependencyFailure(
        { module: "materials", operation: "readHomePinnedProduct" },
        error,
        mapPostgresReadError(error),
      ),
    };
  }
}

export function loadHomePinnedProduct(
  products: Pick<ProductDiscovery, "homePin">,
): Promise<HomePinnedProduct | null> {
  return products.homePin();
}
