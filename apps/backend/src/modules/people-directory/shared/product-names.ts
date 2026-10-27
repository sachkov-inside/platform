import {
  dependencyFailure,
  reportDependencyFailure,
} from "../../../infrastructure/observability/index.js";
import type { PeopleDirectoryDependencies } from "./people-composition.js";

/**
 * Catalogue names of the Products a page names. Products are archived, never deleted, so a
 * missing one is a broken invariant: the page is refused rather than shown with a blank name.
 */
export async function readProductNames(
  dependencies: Pick<PeopleDirectoryDependencies, "products">,
  productIds: readonly string[],
): Promise<ReadonlyMap<string, string> | undefined> {
  if (productIds.length === 0) return new Map();
  try {
    const products = await dependencies.products.metadata({
      ids: productIds,
    });
    const names = new Map(
      products.map((product) => [product.id, product.name]),
    );
    if (productIds.some((id) => !names.has(id))) {
      reportDependencyFailure(
        { module: "people-directory", operation: "readProductNames" },
        new RangeError("Product Access names a Product the catalogue lacks"),
      );
      return undefined;
    }
    return names;
  } catch (error) {
    return dependencyFailure(
      { module: "people-directory", operation: "readProductNames" },
      error,
      undefined,
    );
  }
}

export function byName(
  left: { readonly name: string; readonly productId: string },
  right: { readonly name: string; readonly productId: string },
): number {
  const byText = left.name.localeCompare(right.name, "ru");
  if (byText !== 0) return byText;
  return left.productId < right.productId
    ? -1
    : left.productId > right.productId
      ? 1
      : 0;
}
