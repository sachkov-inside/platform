import type { ProductAuthoring } from "../../../products/index.js";
import type { AuthoringSearchGroup } from "../../ports/authoring-search-group.js";

/** The Products group; Products decides `materials:manage`. */
export function assembleProductsSearchGroup(
  authoring: Pick<ProductAuthoring, "searchProducts">,
): AuthoringSearchGroup {
  return {
    kind: "products",
    search: async (request) => {
      const result = await authoring.searchProducts(request);
      return result.ok
        ? {
            ok: true,
            value: {
              kind: "products",
              state: "ready",
              items: result.value.map((product) => ({
                id: product.id,
                name: product.name,
                archived: product.archived,
              })),
            },
          }
        : result;
    },
  };
}
