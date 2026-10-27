import {
  dependencyFailure,
  writeLog,
} from "../../../../infrastructure/observability/index.js";
import {
  authorizePeopleRead,
  failure,
  type PeopleDirectoryDependencies,
  type PeopleDirectoryResult,
} from "../../shared/people-composition.js";
import { byName } from "../../shared/product-names.js";

/**
 * The most Products the choices answer. The catalogue read has no page, so the bound is checked
 * on its answer: a larger catalogue is refused rather than cut.
 */
export const PRODUCT_CHOICES_LIMIT = 1000;

export interface PeopleProductChoice {
  readonly productId: string;
  readonly name: string;
  readonly archived: boolean;
}

/**
 * Every Product of the catalogue, archived ones flagged, sorted by name: the choices of the people
 * list's Product filter and of «Выдать продукт» (#1721). It reads under `billing:manage`, so an
 * owner without `materials:manage` can still choose a Product.
 */
export async function listProductChoices(
  dependencies: Pick<PeopleDirectoryDependencies, "accounts" | "products">,
  actorId: string,
): Promise<PeopleDirectoryResult<readonly PeopleProductChoice[]>> {
  const refused = await authorizePeopleRead(dependencies, actorId);
  if (refused !== undefined) return refused;
  let products: Awaited<
    ReturnType<PeopleDirectoryDependencies["products"]["metadata"]>
  >;
  try {
    products = await dependencies.products.metadata();
  } catch (error) {
    return dependencyFailure(
      { module: "people-directory", operation: "listProductChoices" },
      error,
      failure("dependency_unavailable"),
    );
  }
  if (products.length > PRODUCT_CHOICES_LIMIT) {
    writeLog("error", "product_choices_bound_exceeded", {
      module: "people-directory",
      operation: "listProductChoices",
      bound: PRODUCT_CHOICES_LIMIT,
    });
    return failure("dependency_unavailable");
  }
  return {
    ok: true,
    value: products
      .map((product) => ({
        productId: product.id,
        name: product.name,
        archived: product.archivedAt !== null,
      }))
      .sort(byName),
  };
}
